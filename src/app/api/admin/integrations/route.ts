import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { dispatch } from '@/lib/notify';
import { roleIn } from '@/lib/admin-auth';
import { greenCreds, greenState } from '@/lib/green';

export const runtime = 'nodejs';

/** Whether the event has a WhatsApp connection, and where it is kept. Never returns the token. `?check=1` also asks Green API for the live state. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const eventId = u.searchParams.get('event') ?? '';
  if (!/^[0-9a-f-]{36}$/.test(eventId)) return NextResponse.json({ ok: false }, { status: 400 });
  if (!(await roleIn(eventId))) return NextResponse.json({ ok: false }, { status: 401 });
  const c = await greenCreds(eventId);
  const state = c && u.searchParams.get('check') ? (await greenState(c)).state : null;
  return NextResponse.json({ ok: true, greenApiConfigured: !!c, source: c?.source ?? null, instance: c ? `${c.instance.slice(0, 4)}…` : null, state });
}

/** Sends a test message through one integration. RLS limits the lookup to event owners. */
export async function POST(req: Request) {
  const db = await supabaseServer();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const parsed = z.object({ id: z.string().uuid() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });
  const { data: it } = await db.from('integrations').select('id,event_id').eq('id', parsed.data.id).maybeSingle();
  if (!it) return NextResponse.json({ ok: false }, { status: 404 });
  const res = await dispatch(it.event_id, 'test', null, null, it.id);
  return NextResponse.json({ ok: res.failed === 0 && res.sent > 0, ...res });
}

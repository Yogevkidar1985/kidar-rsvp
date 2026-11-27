import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { dispatch, greenApiConfigured } from '@/lib/notify';

export const runtime = 'nodejs';

/** Whether the server holds Green API credentials. Never returns the credentials. */
export async function GET() {
  const db = await supabaseServer();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true, greenApiConfigured: greenApiConfigured() });
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

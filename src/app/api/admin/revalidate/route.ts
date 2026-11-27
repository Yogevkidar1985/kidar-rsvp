import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { roleIn } from '@/lib/admin-auth';

export const runtime = 'nodejs';

/** Called after a change to an event is saved: guests see it on their next visit instead of when the short cache runs out. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { eventId?: string; was?: string } | null;
  const eventId = body?.eventId ?? '';
  if (!/^[0-9a-f-]{36}$/.test(eventId)) return NextResponse.json({ ok: false }, { status: 400 });
  if (!(await roleIn(eventId))) return NextResponse.json({ ok: false }, { status: 401 });
  const { data } = await supabaseAdmin().from('events').select('slug').eq('id', eventId).maybeSingle();
  if (data?.slug) revalidateTag(`inv:${data.slug}`);
  // an address that was just replaced must stop answering too
  if (body?.was && /^[a-z0-9][a-z0-9-]{2,60}$/.test(body.was)) revalidateTag(`inv:${body.was}`);
  return NextResponse.json({ ok: true });
}

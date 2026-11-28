import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { roleIn } from '@/lib/admin-auth';

export const runtime = 'nodejs';

/** Every main photo this event ever had, newest first. A replaced photo stays in storage, so it can be chosen again. */
export async function GET(req: Request) {
  const eventId = new URL(req.url).searchParams.get('event') ?? '';
  if (!z.string().uuid().safeParse(eventId).success) return NextResponse.json({ ok: false }, { status: 400 });
  if (!(await roleIn(eventId))) return NextResponse.json({ ok: false }, { status: 401 });
  const bucket = supabaseAdmin().storage.from('event-media');
  const { data, error } = await bucket.list(eventId, { limit: 300, sortBy: { column: 'created_at', order: 'desc' } });
  if (error) return NextResponse.json({ ok: true, heroes: [] });
  const heroes = (data ?? []).filter((f) => f.name.startsWith('hero-')).slice(0, 24).map((f) => bucket.getPublicUrl(`${eventId}/${f.name}`).data.publicUrl);
  return NextResponse.json({ ok: true, heroes }, { headers: { 'Cache-Control': 'no-store' } });
}

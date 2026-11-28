import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { canSend, roleIn } from '@/lib/admin-auth';

export const runtime = 'nodejs';

/** One file with everything the event is made of. Keys, tokens of services and passwords are never part of it. */
export async function GET(req: Request) {
  const eventId = new URL(req.url).searchParams.get('event') ?? '';
  if (!z.string().uuid().safeParse(eventId).success) return NextResponse.json({ ok: false }, { status: 400 });
  const me = await roleIn(eventId);
  if (!me) return NextResponse.json({ ok: false }, { status: 401 });
  if (!canSend(me.role)) return NextResponse.json({ ok: false }, { status: 403 });
  const db = supabaseAdmin();
  const [ev, guests, tables, media, templates] = await Promise.all([
    db.from('events').select('*').eq('id', eventId).maybeSingle(),
    db.from('guests').select('*').eq('event_id', eventId).order('created_at', { ascending: true }),
    db.from('tables').select('*').eq('event_id', eventId).order('created_at', { ascending: true }),
    db.from('media_assets').select('*').eq('event_id', eventId),
    db.from('message_templates').select('*').eq('event_id', eventId), // absent before its database update: then simply empty
  ]);
  if (!ev.data) return NextResponse.json({ ok: false }, { status: 404 });
  const slug = String((ev.data as { slug?: string }).slug ?? 'event');
  const file = {
    format: 'kidar-rsvp-backup', version: 1, exported_at: new Date().toISOString(), event_id: eventId,
    event: ev.data, guests: guests.data ?? [], tables: tables.data ?? [], media: media.data ?? [], templates: templates.data ?? [],
  };
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return new NextResponse(JSON.stringify(file, null, 1), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="backup-${slug}-${stamp}.json"`, 'Cache-Control': 'no-store' } });
}

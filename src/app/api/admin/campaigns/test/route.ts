import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { canSend, roleIn } from '@/lib/admin-auth';
import { sendWhatsApp } from '@/lib/outbox';
import { render, variables, variableLabel } from '@/lib/templates';

export const runtime = 'nodejs';
const schema = z.object({ eventId: z.string().uuid(), body: z.string().trim().min(1).max(2000) });

/** Sends the message as a test to the event's own notification numbers (the hosts), never to a guest. */
export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: 'הנתונים אינם תקינים.' }, { status: 400 });
  const me = await roleIn(parsed.data.eventId);
  if (!me) return NextResponse.json({ ok: false }, { status: 401 });
  if (!canSend(me.role)) return NextResponse.json({ ok: false }, { status: 403 });
  const db = supabaseAdmin();
  const [{ data: ev }, { data: its }] = await Promise.all([
    db.from('events').select('*').eq('id', parsed.data.eventId).maybeSingle(),
    db.from('integrations').select('config').eq('event_id', parsed.data.eventId).eq('type', 'greenapi').eq('enabled', true),
  ]);
  if (!ev) return NextResponse.json({ ok: false }, { status: 404 });
  const targets = (its ?? []).flatMap((i) => ((i.config as { recipients?: { name: string; phone: string }[] })?.recipients ?? []));
  if (!targets.length) return NextResponse.json({ ok: false, message: 'אין מספרים לקבלת התראות. מוסיפים אותם ב"התראות וחיבורים".' }, { status: 400 });
  const site = (process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin).replace(/\/+$/, '');
  let sent = 0; const errors: string[] = [];
  for (const t of targets.slice(0, 5)) {
    const { text, missing } = render(parsed.data.body, variables(ev, { family_name: t.name, contact_name: t.name }, site));
    if (missing.length) return NextResponse.json({ ok: false, message: `חסר ערך: ${missing.map(variableLabel).join(', ')}` }, { status: 400 });
    try { await sendWhatsApp(t.phone, `[בדיקה]\n${text}`); sent++; } catch (e) { errors.push(e instanceof Error ? e.message : 'שגיאה'); }
  }
  return NextResponse.json({ ok: sent > 0 && !errors.length, sent, message: errors[0] ?? null });
}

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { canSend, roleIn } from '@/lib/admin-auth';
import { normPhone } from '@/lib/phone';
import { eventStart } from '@/lib/when';
import { render, variables, variableLabel } from '@/lib/templates';

export const runtime = 'nodejs';
const schema = z.object({
  eventId: z.string().uuid(),
  kind: z.enum(['invite', 'reminder']),
  name: z.string().trim().min(1).max(120),
  templateName: z.string().max(80).nullish(),
  body: z.string().trim().min(1).max(2000),
  guestIds: z.array(z.string().uuid()).max(2000).optional(),
  manual: z.object({ name: z.string().trim().min(2).max(80), phone: z.string().max(20), save: z.boolean() }).optional(),
  allowResend: z.boolean().optional(),
  scheduledAt: z.string().datetime().optional(),
});
const bad = (message: string, status = 400) => NextResponse.json({ ok: false, message }, { status });

/** Creates an invitation campaign (recipients fixed now) or schedules a reminder (recipients chosen when it comes due). */
export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad('הנתונים אינם תקינים.');
  const v = parsed.data;
  const me = await roleIn(v.eventId);
  if (!me) return bad('אין הרשאה.', 401);
  if (!canSend(me.role)) return bad('רק עורכים ובעלי האירוע יכולים לשלוח הודעות.', 403);

  const db = supabaseAdmin();
  const { data: ev } = await db.from('events').select('*').eq('id', v.eventId).maybeSingle();
  if (!ev) return bad('האירוע לא נמצא.', 404);
  if (!ev.published) return bad('צריך לפרסם את ההזמנה לפני ששולחים אותה: בלי פרסום הקישור לא נפתח.');
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin).replace(/\/+$/, '');
  const check = render(v.body, variables(ev, { family_name: 'משפחת ישראלי', contact_name: 'ישראל', invite_token: 'x' }, siteUrl));
  if (check.missing.length) return bad(`בהודעה יש משתנים בלי ערך: ${check.missing.map(variableLabel).join(', ')}. מלאו את הפרטים בעיצוב ההזמנה או הסירו אותם מההודעה.`);
  const start = eventStart(ev);
  const base = { event_id: v.eventId, kind: v.kind, name: v.name, template_name: v.templateName ?? null, body: v.body, site_url: siteUrl, created_by: me.userId };

  if (v.kind === 'reminder') {
    const at = v.scheduledAt ? new Date(v.scheduledAt) : null;
    if (!at || !start) return bad('חסר מועד לתזכורת או לאירוע.');
    if (at.getTime() <= Date.now()) return bad('מועד התזכורת כבר עבר.');
    if (at >= start) return bad('תזכורת נשלחת רק לפני תחילת האירוע.');
    const { data: same } = await db.from('campaigns').select('id').eq('event_id', v.eventId).eq('kind', 'reminder').eq('status', 'scheduled').eq('scheduled_at', at.toISOString());
    if (same?.length) return bad('כבר קיימת תזכורת מתוזמנת לאותה שעה.');
    const { data: c, error } = await db.from('campaigns').insert({ ...base, status: 'scheduled', scheduled_at: at.toISOString() }).select('id').single();
    if (error || !c) return bad('לא הצלחנו לשמור את התזכורת.', 500);
    return NextResponse.json({ ok: true, id: c.id });
  }

  if (start && Date.now() >= start.getTime()) return bad('האירוע כבר התחיל.');
  type Rec = { guest_id: string | null; name: string; phone: string };
  const recs = new Map<string, Rec>();
  const skipped = { invited: 0, noPhone: 0, optedOut: 0 };
  if (v.guestIds?.length) {
    const { data: gs } = await db.from('guests').select('id,family_name,contact_name,phone_norm,invited_at,opted_out').eq('event_id', v.eventId).in('id', v.guestIds);
    for (const g of gs ?? []) {
      if (!g.phone_norm) skipped.noPhone++;
      else if (g.opted_out) skipped.optedOut++;
      else if (g.invited_at && !v.allowResend) skipped.invited++;
      else recs.set(g.phone_norm, { guest_id: g.id, name: g.contact_name || g.family_name, phone: g.phone_norm });
    }
  }
  if (v.manual) {
    const phone = normPhone(v.manual.phone);
    if (!phone) return bad('מספר הטלפון אינו תקין.');
    const { data: known } = await db.from('guests').select('id,family_name,contact_name,invited_at,opted_out').eq('event_id', v.eventId).eq('phone_norm', phone).maybeSingle();
    if (known?.opted_out) return bad('האורח הזה ביקש לא לקבל הודעות.');
    if (known?.invited_at && !v.allowResend) return bad('המספר הזה כבר קיבל הזמנה. סמנו "שליחה חוזרת" כדי לשלוח שוב.');
    let guestId: string | null = known?.id ?? null;
    if (!known && v.manual.save) {
      const { data: g, error } = await db.from('guests').insert({ event_id: v.eventId, family_name: v.manual.name, contact_name: v.manual.name, phone, source: 'admin' }).select('id').single();
      if (error || !g) return bad('לא הצלחנו להוסיף את האורח לרשימה.', 500);
      guestId = g.id;
    }
    recs.set(phone, { guest_id: guestId, name: known ? known.contact_name || known.family_name : v.manual.name, phone });
  }
  if (!recs.size) return NextResponse.json({ ok: false, message: 'אין נמענים לשליחה אחרי הסינון.', skipped }, { status: 400 });

  const { data: c, error } = await db.from('campaigns').insert({ ...base, status: 'sending', started_at: new Date().toISOString() }).select('id').single();
  if (error || !c) return bad('לא הצלחנו ליצור את הקמפיין.', 500);
  const { error: mErr } = await db.from('messages').upsert([...recs.values()].map((r) => ({ ...r, event_id: v.eventId, campaign_id: c.id })), { onConflict: 'campaign_id,phone', ignoreDuplicates: true });
  if (mErr) { await db.from('campaigns').delete().eq('id', c.id); return bad('לא הצלחנו להכין את רשימת הנמענים.', 500); }
  return NextResponse.json({ ok: true, id: c.id, queued: recs.size, skipped });
}

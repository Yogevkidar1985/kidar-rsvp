import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { canSend, roleIn } from '@/lib/admin-auth';
import { pairKey } from '@/lib/duplicates';

export const runtime = 'nodejs';
const uuid = z.string().uuid();

/** Pairs a person marked as different people, and the merges made so far. */
export async function GET(req: Request) {
  const eventId = new URL(req.url).searchParams.get('event') ?? '';
  if (!uuid.safeParse(eventId).success) return NextResponse.json({ ok: false }, { status: 400 });
  if (!(await roleIn(eventId))) return NextResponse.json({ ok: false }, { status: 401 });
  const { data } = await supabaseAdmin().from('audit_logs').select('id,action,entity_id,diff,created_at')
    .eq('event_id', eventId).eq('entity', 'guest').in('action', ['not_duplicate', 'duplicate_again', 'merge']).order('id', { ascending: true }).limit(2000);
  const dismissed = new Set<string>();
  const merges: { id: number; at: string; kept: string; names: string[] }[] = [];
  for (const r of data ?? []) {
    const d = (r.diff ?? {}) as { pair?: string; merged?: { family_name?: string }[]; kept_name?: string };
    if (r.action === 'not_duplicate' && d.pair) dismissed.add(d.pair);
    else if (r.action === 'duplicate_again' && d.pair) dismissed.delete(d.pair);
    else if (r.action === 'merge') merges.push({ id: r.id, at: r.created_at, kept: d.kept_name ?? '', names: (d.merged ?? []).map((m) => m.family_name ?? '') });
  }
  return NextResponse.json({ ok: true, dismissed: [...dismissed], merges: merges.reverse().slice(0, 50) });
}

// what a merge may write onto the record that stays
const patchSchema = z.object({
  family_name: z.string().trim().min(1).max(120), contact_name: z.string().trim().max(120).nullable(), phone: z.string().trim().max(20).nullable(),
  status: z.enum(['pending', 'attending', 'maybe', 'declined']), adults: z.number().int().min(0).max(100), children: z.number().int().min(0).max(100), babies: z.number().int().min(0).max(100),
  allocated_seats: z.number().int().min(0).max(100).nullable(), group_name: z.string().trim().max(60).nullable(), table_id: uuid.nullable(), is_vip: z.boolean(),
  notes: z.string().max(1000).nullable(), preferences: z.string().max(1000).nullable(), admin_notes: z.string().max(1000).nullable(),
}).partial();
const body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('dismiss'), eventId: uuid, ids: z.array(uuid).min(2).max(12) }),
  z.object({ action: z.literal('restore'), eventId: uuid, ids: z.array(uuid).min(2).max(12) }),
  z.object({ action: z.literal('merge'), eventId: uuid, keepId: uuid, mergeIds: z.array(uuid).min(1).max(11), patch: patchSchema }),
]);

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: 'הנתונים אינם תקינים.' }, { status: 400 });
  const v = parsed.data;
  const me = await roleIn(v.eventId);
  if (!me) return NextResponse.json({ ok: false }, { status: 401 });
  if (!canSend(me.role)) return NextResponse.json({ ok: false, message: 'אין לך הרשאה לפעולה הזו.' }, { status: 403 });
  const db = supabaseAdmin();

  if (v.action === 'dismiss' || v.action === 'restore') {
    const rows = [];
    for (let i = 0; i < v.ids.length; i++) for (let j = i + 1; j < v.ids.length; j++) {
      rows.push({ event_id: v.eventId, actor: me.userId, action: v.action === 'dismiss' ? 'not_duplicate' : 'duplicate_again', entity: 'guest', entity_id: v.ids[i], diff: { pair: pairKey(v.ids[i], v.ids[j]) } });
    }
    const { error } = await db.from('audit_logs').insert(rows);
    return error ? NextResponse.json({ ok: false, message: 'לא הצלחנו לשמור.' }, { status: 500 }) : NextResponse.json({ ok: true });
  }

  // ---- merge: nothing is lost. The records that go are written whole into the audit log before anything changes. ----
  if (v.mergeIds.includes(v.keepId)) return NextResponse.json({ ok: false, message: 'הרשומה שנשארת לא יכולה להיות גם זו שמתאחדת.' }, { status: 400 });
  const { data: all } = await db.from('guests').select('*').eq('event_id', v.eventId).in('id', [v.keepId, ...v.mergeIds]);
  const keep = (all ?? []).find((g) => g.id === v.keepId);
  const gone = (all ?? []).filter((g) => g.id !== v.keepId);
  if (!keep || gone.length !== v.mergeIds.length) return NextResponse.json({ ok: false, message: 'אחת הרשומות כבר לא קיימת. רעננו את המסך.' }, { status: 409 });
  if (v.patch.table_id) {
    const { data: t } = await db.from('tables').select('id').eq('id', v.patch.table_id).eq('event_id', v.eventId).maybeSingle();
    if (!t) return NextResponse.json({ ok: false, message: 'השולחן שנבחר לא קיים.' }, { status: 400 });
  }
  const earliest = [keep, ...gone].map((g) => g.created_at as string).sort()[0];
  const log = await db.from('audit_logs').insert({ event_id: v.eventId, actor: me.userId, action: 'merge', entity: 'guest', entity_id: keep.id,
    diff: { kept_before: keep, kept_name: v.patch.family_name ?? keep.family_name, merged: gone, patch: v.patch } }).select('id').single();
  if (log.error) return NextResponse.json({ ok: false, message: 'לא הצלחנו לתעד את האיחוד, ולכן הוא לא בוצע.' }, { status: 500 });

  // the history of the records that go moves to the one that stays: answers, messages, visits
  const ids = gone.map((g) => g.id as string);
  for (const table of ['rsvp_responses', 'messages', 'invitation_events']) {
    const r = await db.from(table).update({ guest_id: keep.id }).in('guest_id', ids);
    // the WhatsApp and visit tables exist only after their database update: their absence is not a failure
    if (r.error && table === 'rsvp_responses') return NextResponse.json({ ok: false, message: 'העברת ההיסטוריה נכשלה. שום רשומה לא נמחקה.' }, { status: 500 });
  }
  const del = await db.from('guests').delete().in('id', ids).eq('event_id', v.eventId);
  if (del.error) return NextResponse.json({ ok: false, message: 'האיחוד נעצר לפני מחיקת הכפילות. שום רשומה לא נמחקה.' }, { status: 500 });
  // the one that stays keeps the earliest registration time of them all
  const upd = await db.from('guests').update({ ...v.patch, created_at: earliest }).eq('id', keep.id).select('*').maybeSingle();
  if (upd.error || !upd.data) {
    return NextResponse.json({ ok: false, partial: true, message: `הכפילות אוחדה, אבל חלק מהפרטים לא התעדכנו (${upd.error?.message?.includes('TABLE_FULL') ? 'אין מקום בשולחן שנבחר' : 'שגיאה בשמירה'}). עדכנו אותם ידנית.` }, { status: 207 });
  }
  return NextResponse.json({ ok: true, guest: upd.data, logId: log.data.id });
}

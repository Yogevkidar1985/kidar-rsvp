import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { canSend, roleIn } from '@/lib/admin-auth';
import { EVENT_KEEP, GUEST_COLUMNS, seatingSummary, type Seating } from '@/lib/versions';

export const runtime = 'nodejs';
const uuid = z.string().uuid();
type Db = ReturnType<typeof supabaseAdmin>;
type Row = Record<string, unknown>;
const bad = (message: string, status = 400) => NextResponse.json({ ok: false, message }, { status });
const KEEP = { auto: 30, manual: 40 };

/** What the event looks like now, without the fields a restore must never move. */
async function eventNow(db: Db, eventId: string) {
  const { data } = await db.from('events').select('*').eq('id', eventId).maybeSingle();
  if (!data) return null;
  const row = { ...(data as Row) };
  for (const k of ['id', 'created_at', 'updated_at']) delete row[k];
  return row;
}
async function seatingNow(db: Db, eventId: string): Promise<Seating> {
  const [t, g] = await Promise.all([
    db.from('tables').select('id,name,capacity,pos_x,pos_y,shape').eq('event_id', eventId).order('created_at', { ascending: true }),
    db.from('guests').select('id,table_id').eq('event_id', eventId),
  ]);
  return {
    tables: (t.data ?? []) as Seating['tables'],
    seats: ((g.data ?? []) as { id: string; table_id: string | null }[]).filter((x) => x.table_id).map((x) => ({ g: x.id, t: x.table_id as string })),
  };
}
/** The database stores a copy with its keys in its own order, so two copies are compared key by key, not as text. */
const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as Row).sort().map((k) => [k, canon((v as Row)[k])])) : v);
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

/** Keeps a copy of the current state. A copy identical to the last one is not written twice. */
async function snapshot(db: Db, eventId: string, actor: string, kind: 'event' | 'seating', label: string, auto: boolean) {
  const data = kind === 'event' ? await eventNow(db, eventId) : await seatingNow(db, eventId);
  if (!data) return { id: null as number | null, fresh: false };
  const { data: prev } = await db.from('audit_logs').select('id,action,diff').eq('event_id', eventId).eq('entity', 'version').in('action', [kind, `${kind}:auto`]).order('id', { ascending: false }).limit(80);
  const list = (prev ?? []) as { id: number; action: string; diff: { data?: unknown } }[];
  if (auto && list[0] && same(list[0].diff?.data, data)) return { id: list[0].id, fresh: false };
  const summary = kind === 'seating' ? seatingSummary(data as Seating) : String((data as Row).name ?? '');
  const ins = await db.from('audit_logs').insert({ event_id: eventId, actor, action: auto ? `${kind}:auto` : kind, entity: 'version', entity_id: eventId, diff: { label, summary, data } }).select('id').single();
  if (ins.error) return { id: null, fresh: false };
  // old copies make room: the newest are kept, saved-by-hand ones longer than automatic ones
  const mine = list.filter((r) => r.action === (auto ? `${kind}:auto` : kind)).map((r) => r.id);
  const drop = mine.slice((auto ? KEEP.auto : KEEP.manual) - 1);
  if (drop.length) await db.from('audit_logs').delete().in('id', drop.map(String)).eq('event_id', eventId).eq('entity', 'version');
  return { id: (ins.data as { id: number }).id, fresh: true };
}

async function applySeating(db: Db, eventId: string, s: Seating) {
  const { data: nowT } = await db.from('tables').select('id').eq('event_id', eventId);
  const have = new Set(((nowT ?? []) as { id: string }[]).map((t) => t.id)), want = new Set(s.tables.map((t) => t.id));
  // everyone stands up first: a table can then shrink, move or go without the database refusing a seat
  const up = await db.from('guests').update({ table_id: null }).eq('event_id', eventId);
  if (up.error) return { ok: false as const };
  const gone = [...have].filter((id) => !want.has(id));
  if (gone.length) await db.from('tables').delete().in('id', gone).eq('event_id', eventId);
  for (const t of s.tables) {
    const row = { name: t.name, capacity: t.capacity, pos_x: t.pos_x, pos_y: t.pos_y, shape: t.shape };
    const r = have.has(t.id) ? await db.from('tables').update(row).eq('id', t.id).eq('event_id', eventId) : await db.from('tables').insert({ ...row, id: t.id, event_id: eventId });
    if (r.error) return { ok: false as const };
  }
  let seated = 0, skipped = 0;
  for (const x of s.seats) {
    const r = await db.from('guests').update({ table_id: x.t }).eq('id', x.g).eq('event_id', eventId).select('id');
    if (r.error || !r.data?.length) skipped++; else seated++; // a family deleted since, or one that grew past the table
  }
  return { ok: true as const, seated, skipped };
}

function eventPatch(data: Row) {
  const patch: Row = {};
  for (const [k, v] of Object.entries(data)) if (!EVENT_KEEP.includes(k)) patch[k] = v;
  return patch;
}

async function archive(db: Db, eventId: string) {
  const [{ data: logs }, { data: live }] = await Promise.all([
    db.from('audit_logs').select('id,action,diff,created_at').eq('event_id', eventId).eq('entity', 'guest').in('action', ['archive', 'merge', 'unarchive']).order('id', { ascending: false }).limit(400),
    db.from('guests').select('id').eq('event_id', eventId),
  ]);
  const alive = new Set(((live ?? []) as { id: string }[]).map((g) => g.id));
  const out: { log: number; id: string; at: string; why: 'deleted' | 'merged'; into?: string; guest: Row }[] = [];
  const seen = new Set<string>();
  for (const r of (logs ?? []) as { id: number; action: string; created_at: string; diff: { guest?: Row; merged?: Row[]; kept_name?: string } }[]) {
    const rows = r.action === 'archive' ? [r.diff?.guest] : r.action === 'merge' ? r.diff?.merged ?? [] : [];
    for (const g of rows) {
      const gid = String(g?.id ?? '');
      if (!g || !gid || alive.has(gid) || seen.has(gid)) continue;
      seen.add(gid);
      out.push({ log: r.id, id: gid, at: r.created_at, why: r.action === 'merge' ? 'merged' : 'deleted', into: r.action === 'merge' ? r.diff?.kept_name : undefined, guest: g });
    }
  }
  return out;
}

async function insertGuest(db: Db, eventId: string, g: Row, tables: Set<string>) {
  const row: Row = { event_id: eventId };
  for (const k of GUEST_COLUMNS) if (g[k] !== undefined) row[k] = g[k];
  if (row.table_id && !tables.has(String(row.table_id))) row.table_id = null;
  let r = await db.from('guests').insert(row).select('id');
  if (r.error && row.table_id) { row.table_id = null; r = await db.from('guests').insert(row).select('id'); } // the table filled up meanwhile
  if (r.error) { for (const k of ['invited_at', 'reminders_enabled', 'opted_out', 'link_code']) delete row[k]; r = await db.from('guests').insert(row).select('id'); }
  return !r.error;
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams, eventId = q.get('event') ?? '';
  if (!uuid.safeParse(eventId).success) return bad('הנתונים אינם תקינים.');
  const me = await roleIn(eventId);
  if (!me) return NextResponse.json({ ok: false }, { status: 401 });
  const db = supabaseAdmin();

  if (q.get('archive')) {
    const rows = await archive(db, eventId);
    return NextResponse.json({ ok: true, guests: rows.map((r) => ({ log: r.log, id: r.id, at: r.at, why: r.why, into: r.into ?? null, family_name: r.guest.family_name ?? '', phone: r.guest.phone ?? null, status: r.guest.status ?? 'pending', people: Number(r.guest.adults ?? 0) + Number(r.guest.children ?? 0) + Number(r.guest.babies ?? 0) })) });
  }
  const one = q.get('id');
  if (one) {
    const { data } = await db.from('audit_logs').select('id,action,diff,created_at').eq('event_id', eventId).eq('entity', 'version').eq('id', one).maybeSingle();
    if (!data) return bad('הגרסה לא נמצאה.', 404);
    const d = data as { id: number; action: string; created_at: string; diff: { label?: string; data?: unknown } };
    return NextResponse.json({ ok: true, version: { id: d.id, kind: d.action.split(':')[0], at: d.created_at, label: d.diff?.label ?? '', data: d.diff?.data ?? null } });
  }
  const kind = q.get('kind') === 'seating' ? 'seating' : 'event';
  const { data } = await db.from('audit_logs').select('id,action,diff,created_at').eq('event_id', eventId).eq('entity', 'version').in('action', [kind, `${kind}:auto`]).order('id', { ascending: false }).limit(80);
  const versions = ((data ?? []) as { id: number; action: string; created_at: string; diff: { label?: string; summary?: string } }[])
    .map((r) => ({ id: r.id, kind, auto: r.action.endsWith(':auto'), at: r.created_at, label: r.diff?.label ?? '', summary: r.diff?.summary ?? '' }));
  return NextResponse.json({ ok: true, versions });
}

const body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('snapshot'), eventId: uuid, kind: z.enum(['event', 'seating']), label: z.string().trim().max(80).default(''), auto: z.boolean().default(false) }),
  z.object({ action: z.literal('restore'), eventId: uuid, id: z.number().int().positive() }),
  z.object({ action: z.literal('remove'), eventId: uuid, id: z.number().int().positive() }),
  z.object({ action: z.literal('delete_guest'), eventId: uuid, guestId: uuid }),
  z.object({ action: z.literal('restore_guest'), eventId: uuid, guestId: uuid }),
  z.object({ action: z.literal('import'), eventId: uuid, parts: z.array(z.enum(['event', 'guests'])).min(1), backup: z.object({ format: z.literal('kidar-rsvp-backup'), event_id: z.string(), event: z.record(z.unknown()).optional(), guests: z.array(z.record(z.unknown())).max(5000).optional() }).passthrough() }),
]);

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad('הנתונים אינם תקינים.');
  const v = parsed.data;
  const me = await roleIn(v.eventId);
  if (!me) return NextResponse.json({ ok: false }, { status: 401 });
  if (!canSend(me.role)) return bad('אין לך הרשאה לפעולה הזו.', 403);
  const db = supabaseAdmin();

  if (v.action === 'snapshot') {
    const s = await snapshot(db, v.eventId, me.userId, v.kind, v.label || (v.auto ? 'שמירה אוטומטית' : 'נקודת שחזור'), v.auto);
    return s.id ? NextResponse.json({ ok: true, id: s.id, fresh: s.fresh }) : bad('לא הצלחנו לשמור נקודת שחזור.', 500);
  }
  if (v.action === 'remove') {
    await db.from('audit_logs').delete().eq('id', String(v.id)).eq('event_id', v.eventId).eq('entity', 'version');
    return NextResponse.json({ ok: true });
  }
  if (v.action === 'restore') {
    const { data } = await db.from('audit_logs').select('id,action,diff').eq('event_id', v.eventId).eq('entity', 'version').eq('id', String(v.id)).maybeSingle();
    const row = data as { action: string; diff: { data?: unknown; label?: string } } | null;
    if (!row?.diff?.data) return bad('הגרסה לא נמצאה.', 404);
    const kind = row.action.split(':')[0] as 'event' | 'seating';
    // the state that is about to be replaced is kept first, so a restore can itself be undone
    const before = await snapshot(db, v.eventId, me.userId, kind, 'לפני שחזור', true);
    if (!before.id) return bad('לא הצלחנו לשמור את המצב הנוכחי, ולכן לא שוחזר דבר.', 500);
    if (kind === 'seating') {
      const r = await applySeating(db, v.eventId, row.diff.data as Seating);
      if (!r.ok) return bad('השחזור נעצר באמצע. אפשר לחזור למצב הקודם מרשימת הגרסאות.', 500);
      return NextResponse.json({ ok: true, kind, before: before.id, seated: r.seated, skipped: r.skipped });
    }
    const upd = await db.from('events').update(eventPatch(row.diff.data as Row)).eq('id', v.eventId).select('*').single();
    if (upd.error || !upd.data) return bad('השחזור נכשל. שום דבר לא השתנה.', 500);
    return NextResponse.json({ ok: true, kind, before: before.id, event: upd.data });
  }
  if (v.action === 'delete_guest') {
    const { data: g } = await db.from('guests').select('*').eq('id', v.guestId).eq('event_id', v.eventId).maybeSingle();
    if (!g) return bad('המשפחה כבר לא קיימת.', 404);
    const log = await db.from('audit_logs').insert({ event_id: v.eventId, actor: me.userId, action: 'archive', entity: 'guest', entity_id: v.guestId, diff: { guest: g } });
    if (log.error) return bad('לא הצלחנו לשמור עותק, ולכן המשפחה לא נמחקה.', 500);
    const del = await db.from('guests').delete().eq('id', v.guestId).eq('event_id', v.eventId);
    return del.error ? bad('המחיקה נכשלה.', 500) : NextResponse.json({ ok: true });
  }
  if (v.action === 'restore_guest') {
    const hit = (await archive(db, v.eventId)).find((r) => r.id === v.guestId);
    if (!hit) return bad('המשפחה לא נמצאת בארכיון, או שהיא כבר ברשימה.', 404);
    const { data: t } = await db.from('tables').select('id').eq('event_id', v.eventId);
    const ok = await insertGuest(db, v.eventId, hit.guest, new Set(((t ?? []) as { id: string }[]).map((x) => x.id)));
    if (!ok) return bad('לא הצלחנו להחזיר את המשפחה. ייתכן שהטלפון או הקישור שלה כבר בשימוש של משפחה אחרת.', 409);
    await db.from('audit_logs').insert({ event_id: v.eventId, actor: me.userId, action: 'unarchive', entity: 'guest', entity_id: v.guestId, diff: { from: hit.log } });
    return NextResponse.json({ ok: true });
  }
  // ---- from a backup file: the design and texts, and families that are missing. Nothing that exists is overwritten. ----
  if (v.backup.event_id !== v.eventId) return bad('הקובץ הזה הוא גיבוי של אירוע אחר.');
  const out: { event?: boolean; added?: number; skipped?: number } = {};
  if (v.parts.includes('event') && v.backup.event) {
    const cur = await eventNow(db, v.eventId);
    if (!cur) return bad('האירוע לא נמצא.', 404);
    const patch: Row = {};
    for (const [k, val] of Object.entries(eventPatch(v.backup.event))) if (k in cur) patch[k] = val; // only fields this event really has
    await snapshot(db, v.eventId, me.userId, 'event', 'לפני שחזור מקובץ', true);
    const upd = await db.from('events').update(patch).eq('id', v.eventId).select('id').single();
    if (upd.error) return bad('שחזור ההזמנה מהקובץ נכשל. שום דבר לא השתנה.', 500);
    out.event = true;
  }
  if (v.parts.includes('guests') && v.backup.guests) {
    const [{ data: live }, { data: t }] = await Promise.all([db.from('guests').select('id').eq('event_id', v.eventId), db.from('tables').select('id').eq('event_id', v.eventId)]);
    const alive = new Set(((live ?? []) as { id: string }[]).map((g) => g.id)), tables = new Set(((t ?? []) as { id: string }[]).map((x) => x.id));
    out.added = 0; out.skipped = 0;
    for (const g of v.backup.guests) {
      if (!uuid.safeParse(g.id).success || alive.has(String(g.id)) || typeof g.family_name !== 'string') continue;
      if (await insertGuest(db, v.eventId, g, tables)) out.added++; else out.skipped++;
    }
  }
  return NextResponse.json({ ok: true, ...out });
}

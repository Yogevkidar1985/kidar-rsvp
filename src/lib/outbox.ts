import 'server-only';
import { supabaseAdmin } from './supabase/admin';
import { intlPhone } from './phone';
import { eventStart } from './when';
import { render, variables, variableLabel, type EventForMessage } from './templates';
import { greenCreds, type GreenCreds } from './green';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const EVENT_COLS = 'id,slug,name,hosts,published,event_date,weekday_label,hebrew_date,reception_time,ceremony_time,venue_name,address,waze_url,gmaps_url,design';
type EventRow = EventForMessage & { id: string; published: boolean };
type Camp = { id: string; event_id: string; kind: 'invite' | 'reminder'; body: string; site_url: string; status: string };

class SendError extends Error { constructor(msg: string, public retry: boolean) { super(msg); } }

/** One WhatsApp message through Green API. Resolves with the provider's message id only when Green API accepted it. */
export async function sendWhatsApp(creds: GreenCreds | null, phone: string, message: string): Promise<string> {
  const chat = intlPhone(phone);
  if (!chat) throw new SendError('מספר הטלפון אינו תקין', false);
  if (!creds) throw new SendError('WhatsApp עוד לא חובר לאירוע', true);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(`${creds.url}/waInstance${creds.instance}/sendMessage/${creds.token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId: `${chat}@c.us`, message }), signal: ctl.signal, redirect: 'error',
    });
    if (!r.ok) throw new SendError(`Green API החזיר ${r.status}`, r.status === 429 || r.status >= 500);
    const j = (await r.json().catch(() => null)) as { idMessage?: string } | null;
    if (!j?.idMessage) throw new SendError('Green API לא אישר את ההודעה', false);
    return j.idMessage;
  } catch (e) {
    if (e instanceof SendError) throw e;
    throw new SendError('אין חיבור ל-Green API', true);
  } finally { clearTimeout(timer); }
}

export type TickResult = { due: number; sent: number; failed: number; skipped: number; waiting: boolean };

/**
 * One pass of the sender: opens reminders that came due, then sends queued messages one at a time
 * until `budgetMs` is used. Safe to call from several places at once: each message is claimed under a row lock.
 */
export async function runTick(budgetMs = 6500, now = new Date()): Promise<TickResult> {
  const db = supabaseAdmin();
  const out: TickResult = { due: 0, sent: 0, failed: 0, skipped: 0, waiting: false };
  const started = Date.now();
  const events = new Map<string, EventRow | null>();
  const eventOf = async (id: string) => {
    if (!events.has(id)) events.set(id, ((await db.from('events').select(EVENT_COLS).eq('id', id).maybeSingle()).data as EventRow | null) ?? null);
    return events.get(id)!;
  };

  // 1. reminders whose time has come: recipients are chosen now, not when the reminder was scheduled
  const { data: due } = await db.from('campaigns').select('id,event_id,kind,body,site_url,status')
    .eq('kind', 'reminder').eq('status', 'scheduled').lte('scheduled_at', now.toISOString());
  for (const c of (due ?? []) as Camp[]) {
    const ev = await eventOf(c.event_id);
    const start = ev && eventStart(ev);
    if (!ev || !start || now >= start) {
      await db.from('campaigns').update({ status: 'cancelled', note: 'האירוע כבר התחיל, התזכורת לא נשלחה', finished_at: now.toISOString() }).eq('id', c.id).eq('status', 'scheduled');
      continue;
    }
    const { data: gs } = await db.from('guests').select('id,family_name,contact_name,phone,phone_norm')
      .eq('event_id', c.event_id).eq('status', 'attending').eq('reminders_enabled', true).eq('opted_out', false);
    const rows = (gs ?? []).filter((g) => g.phone_norm).map((g) => ({ event_id: c.event_id, campaign_id: c.id, guest_id: g.id, name: g.contact_name || g.family_name, phone: g.phone_norm as string }));
    if (rows.length) await db.from('messages').upsert(rows, { onConflict: 'campaign_id,phone', ignoreDuplicates: true });
    await db.from('campaigns').update({ status: 'sending', started_at: now.toISOString() }).eq('id', c.id).eq('status', 'scheduled');
    out.due++;
  }

  // 2. a message left in "sending" by a run that died may or may not have gone out: never send it again by itself
  await db.from('messages').update({ status: 'failed', error: 'השליחה נקטעה. לא ידוע אם ההודעה יצאה, בדקו לפני שליחה חוזרת.' })
    .eq('status', 'sending').lt('claimed_at', new Date(now.getTime() - 5 * 60000).toISOString());

  // 3. the queue
  const camps = new Map<string, Camp | null>();
  const creds = new Map<string, GreenCreds | null>();
  const credsOf = async (id: string) => { if (!creds.has(id)) creds.set(id, await greenCreds(id)); return creds.get(id)!; };
  // nothing is claimed while no event with open work has a WhatsApp connection: the queue simply waits
  const { data: open0 } = await db.from('campaigns').select('event_id').eq('status', 'sending');
  const ready = new Set<string>();
  for (const id of new Set((open0 ?? []).map((c) => c.event_id as string))) if (await credsOf(id)) ready.add(id);
  if (!ready.size) out.waiting = true;
  while (!out.waiting && Date.now() - started < budgetMs) {
    const { data: claimed, error } = await db.rpc('claim_messages', { p_limit: 1 });
    if (error) throw new Error('claim failed');
    const m = (claimed as { id: number; campaign_id: string; guest_id: string | null; name: string | null; phone: string; attempts: number }[] | null)?.[0];
    if (!m) break;
    if (!camps.has(m.campaign_id)) camps.set(m.campaign_id, ((await db.from('campaigns').select('id,event_id,kind,body,site_url,status').eq('id', m.campaign_id).maybeSingle()).data as Camp | null) ?? null);
    const c = camps.get(m.campaign_id);
    const ev = c && await eventOf(c.event_id);
    const finish = async (status: 'sent' | 'failed' | 'skipped' | 'pending', patch: Record<string, unknown> = {}) => {
      await db.from('messages').update({ status, ...patch }).eq('id', m.id);
      if (status === 'sent') out.sent++; else if (status === 'failed') out.failed++; else if (status === 'skipped') out.skipped++;
    };
    if (!c || !ev) { await finish('failed', { error: 'הקמפיין או האירוע נמחקו' }); continue; }
    if (!ev.published) { await finish('failed', { error: 'ההזמנה לא מפורסמת, הקישור לא ייפתח' }); continue; }

    // the guest is read again right before sending: the answer may have changed since the message was queued
    const g = m.guest_id ? (await db.from('guests').select('*').eq('id', m.guest_id).maybeSingle()).data : null;
    if (g?.opted_out) { await finish('skipped', { error: 'האורח ביקש לא לקבל הודעות' }); continue; }
    if (c.kind === 'reminder') {
      const start = eventStart(ev);
      if (!g) { await finish('skipped', { error: 'האורח נמחק מהרשימה' }); continue; }
      if (g.status !== 'attending') { await finish('skipped', { error: 'האורח כבר לא מסומן כמגיע' }); continue; }
      if (!g.reminders_enabled) { await finish('skipped', { error: 'התזכורות כבויות לאורח הזה' }); continue; }
      if (!start || new Date() >= start) { await finish('skipped', { error: 'האירוע כבר התחיל' }); continue; }
    }
    const { text, missing } = render(c.body, variables(ev, g ?? { family_name: m.name ?? '', contact_name: m.name }, c.site_url));
    if (missing.length) { await finish('failed', { error: `חסר ערך: ${missing.map(variableLabel).join(', ')}` }); continue; }
    try {
      const id = await sendWhatsApp(await credsOf(c.event_id), m.phone, text);
      const at = new Date().toISOString();
      await finish('sent', { provider_id: id, body: text, sent_at: at, error: null });
      if (c.kind === 'invite' && g && !g.invited_at) await db.from('guests').update({ invited_at: at }).eq('id', g.id);
    } catch (e) {
      const err = e instanceof SendError ? e : new SendError('שגיאה לא צפויה', false);
      if (err.retry && m.attempts < 3) { await finish('pending', { error: err.message }); out.waiting = true; }
      else await finish('failed', { error: err.message });
    }
    await sleep(900); // WhatsApp accounts are flagged for bursts: a message roughly every second, never in parallel
  }

  // 4. campaigns with nothing left to send are done
  const { data: open } = await db.from('campaigns').select('id').eq('status', 'sending');
  for (const c of open ?? []) {
    const { count } = await db.from('messages').select('id', { count: 'exact', head: true }).eq('campaign_id', c.id).in('status', ['pending', 'sending']);
    if (!count) await db.from('campaigns').update({ status: 'done', finished_at: new Date().toISOString() }).eq('id', c.id).eq('status', 'sending');
  }
  return out;
}

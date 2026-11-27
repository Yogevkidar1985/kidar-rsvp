import 'server-only';
import { createHmac } from 'node:crypto';
import { supabaseAdmin } from './supabase/admin';
import { intlPhone } from './phone';
import { buildMessage, type GuestSnapshot, type NotifyKind } from './messages';
import type { Integration } from './types';

export const greenApiConfigured = () => !!(process.env.GREEN_API_INSTANCE_ID && process.env.GREEN_API_TOKEN);

function isPublicHttps(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    return !(h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || /^[\d.]+$/.test(h) || h.includes(':'));
  } catch { return false; }
}

async function post(url: string, body: string, headers: Record<string, string> = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body, signal: ctl.signal, redirect: 'error' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } finally { clearTimeout(timer); }
}

async function sendGreenApi(phone: string, message: string) {
  const chat = intlPhone(phone);
  if (!chat) throw new Error('מספר טלפון לא תקין');
  const base = (process.env.GREEN_API_URL || 'https://api.green-api.com').replace(/\/$/, '');
  await post(`${base}/waInstance${process.env.GREEN_API_INSTANCE_ID}/sendMessage/${process.env.GREEN_API_TOKEN}`,
    JSON.stringify({ chatId: `${chat}@c.us`, message }));
}

/** Sends one event to every enabled integration of the event (or only `onlyId`). Never throws. */
export async function dispatch(eventId: string, kind: NotifyKind, guest: GuestSnapshot | null,
  previous: Partial<GuestSnapshot> | null = null, onlyId?: string): Promise<{ sent: number; failed: number; errors: string[] }> {
  const out = { sent: 0, failed: 0, errors: [] as string[] };
  try {
    const db = supabaseAdmin();
    let q = db.from('integrations').select('*').eq('event_id', eventId);
    q = onlyId ? q.eq('id', onlyId) : q.eq('enabled', true);
    const [{ data: integrations }, { data: ev }, { data: att }] = await Promise.all([
      q, db.from('events').select('name').eq('id', eventId).single(),
      db.from('guests').select('adults,children,babies').eq('event_id', eventId).eq('status', 'attending'),
    ]);
    if (!integrations?.length || !ev) return out;
    const totals = {
      attendingFamilies: att?.length ?? 0,
      attendingPeople: (att ?? []).reduce((n, g) => n + g.adults + g.children + g.babies, 0),
    };
    const text = buildMessage(kind, ev.name, guest, previous, totals);
    const payload = JSON.stringify({ event: kind, event_id: eventId, event_name: ev.name, guest, previous, totals, sent_at: new Date().toISOString() });

    await Promise.all((integrations as Integration[]).map(async (it) => {
      const targets: { target: string; run: () => Promise<void> }[] = [];
      if (it.type === 'webhook') {
        const url = it.config.url ?? '';
        targets.push({ target: url, run: async () => {
          if (!isPublicHttps(url)) throw new Error('כתובת ה-Webhook חייבת להיות https ציבורית');
          const sig = it.config.secret ? createHmac('sha256', it.config.secret).update(payload).digest('hex') : '';
          await post(url, payload, sig ? { 'X-RSVP-Signature': `sha256=${sig}` } : {});
        } });
      } else {
        for (const r of it.config.recipients ?? []) {
          targets.push({ target: r.phone, run: async () => {
            if (!greenApiConfigured()) throw new Error('Green API לא הוגדר בשרת');
            await sendGreenApi(r.phone, text);
          } });
        }
      }
      let lastError: string | null = null, ok = 0;
      for (const t of targets) {
        try { await t.run(); ok++; out.sent++; }
        catch (e) { lastError = e instanceof Error ? e.message : 'שגיאה'; out.failed++; out.errors.push(lastError); }
        await db.from('notifications').insert({ event_id: eventId, integration_id: it.id, kind, target: t.target.slice(0, 200), status: lastError ? 'failed' : 'sent', error: lastError });
      }
      if (targets.length) {
        await db.from('integrations').update({
          last_status: lastError ? (ok ? 'partial' : 'failed') : 'ok', last_error: lastError, last_sent_at: new Date().toISOString(),
        }).eq('id', it.id);
      }
    }));
  } catch (e) {
    out.failed++; out.errors.push(e instanceof Error ? e.message : 'שגיאה');
  }
  return out;
}

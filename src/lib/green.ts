import 'server-only';
import { supabaseAdmin } from './supabase/admin';

export type GreenCreds = { instance: string; token: string; url: string; source: 'env' | 'db' };
const DEFAULT_URL = 'https://api.green-api.com';

/** The WhatsApp connection of an event: the hosting settings if they hold one, otherwise what the owner entered in the admin. */
export async function greenCreds(eventId: string): Promise<GreenCreds | null> {
  if (process.env.GREEN_API_INSTANCE_ID && process.env.GREEN_API_TOKEN) {
    return { instance: process.env.GREEN_API_INSTANCE_ID, token: process.env.GREEN_API_TOKEN, url: (process.env.GREEN_API_URL || DEFAULT_URL).replace(/\/$/, ''), source: 'env' };
  }
  const { data } = await supabaseAdmin().from('event_secrets').select('green_instance,green_token,green_url').eq('event_id', eventId).maybeSingle();
  if (!data?.green_instance || !data.green_token) return null;
  return { instance: data.green_instance, token: data.green_token, url: (data.green_url || DEFAULT_URL).replace(/\/$/, ''), source: 'db' };
}

/** Only Green API's own hosts: a pasted address must not point the server somewhere else. */
export function greenUrl(raw: string | undefined | null): string | null {
  if (!raw?.trim()) return DEFAULT_URL;
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'https:' && /(^|\.)green-api\.com$/i.test(u.hostname) ? u.origin : null;
  } catch { return null; }
}

/** Asks Green API whether these details open an instance, and whether a phone is linked to it. */
export async function greenState(c: Pick<GreenCreds, 'instance' | 'token' | 'url'>): Promise<{ ok: boolean; state: string }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(`${c.url}/waInstance${encodeURIComponent(c.instance)}/getStateInstance/${encodeURIComponent(c.token)}`, { signal: ctl.signal, redirect: 'error' });
    if (!r.ok) return { ok: false, state: r.status === 401 || r.status === 403 ? 'unauthorized' : `http_${r.status}` };
    const j = (await r.json().catch(() => null)) as { stateInstance?: string } | null;
    return { ok: !!j?.stateInstance, state: j?.stateInstance ?? 'unknown' };
  } catch { return { ok: false, state: 'unreachable' }; } finally { clearTimeout(timer); }
}

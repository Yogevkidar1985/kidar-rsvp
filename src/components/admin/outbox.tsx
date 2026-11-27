'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { BUILTIN, VARIABLES, render, variables, variableLabel, type Template, type TemplateKind } from '@/lib/templates';
import type { Campaign, EventRow, Guest, MessageRow } from '@/lib/types';
import { fmtWhen } from '@/lib/when';
import { download, toCsv } from '@/lib/export';
import { useEvent } from './EventContext';
import { Field, Modal, useToast } from './ui';

export const CAMPAIGN_STATUS: Record<Campaign['status'], string> = { scheduled: 'מתוזמן', sending: 'בשליחה', paused: 'מושהה', done: 'הסתיים', cancelled: 'בוטל' };
export const MESSAGE_STATUS: Record<MessageRow['status'], string> = { pending: 'ממתינה', sending: 'בשליחה', sent: 'נשלחה', failed: 'נכשלה', skipped: 'דולגה' };
export type Counts = { total: number; sent: number; failed: number; pending: number; skipped: number };
const zero = (): Counts => ({ total: 0, sent: 0, failed: 0, pending: 0, skipped: 0 });

/** Campaigns, their messages and the saved templates of the event. While something is sending, it nudges the queue and refreshes. */
export function useOutbox() {
  const { event } = useEvent();
  const db = supabaseBrowser();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [custom, setCustom] = useState<Template[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'setup'>('loading');
  const [green, setGreen] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    const [c, m, t] = await Promise.all([
      db.from('campaigns').select('id,event_id,kind,name,template_name,body,status,note,scheduled_at,created_at,started_at,finished_at').eq('event_id', event.id).order('created_at', { ascending: false }),
      db.from('messages').select('id,campaign_id,guest_id,name,phone,body,status,error,attempts,created_at,sent_at').eq('event_id', event.id).order('id'),
      db.from('message_templates').select('id,kind,name,body,is_default').eq('event_id', event.id).order('created_at'),
    ]);
    if (c.error || m.error || t.error) { setState('setup'); return; }
    setCampaigns((c.data as Campaign[]) ?? []); setMessages((m.data as MessageRow[]) ?? []); setCustom((t.data as Template[]) ?? []);
    setState('ready');
  }, [db, event.id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { fetch('/api/admin/integrations').then((r) => r.json()).then((j) => setGreen(!!j.greenApiConfigured)).catch(() => setGreen(null)); }, []);

  const active = campaigns.some((c) => c.status === 'sending');
  const busy = useRef(false);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(async () => {
      if (busy.current || document.hidden) return;
      busy.current = true;
      try { await fetch('/api/cron/tick', { method: 'POST' }); await load(); } catch { /* next round */ } finally { busy.current = false; }
    }, 4000);
    return () => clearInterval(id);
  }, [active, load]);

  const counts = useMemo(() => {
    const by = new Map<string, Counts>();
    for (const m of messages) {
      const c = by.get(m.campaign_id) ?? zero();
      c.total++; if (m.status === 'sent') c.sent++; else if (m.status === 'failed') c.failed++; else if (m.status === 'skipped') c.skipped++; else c.pending++;
      by.set(m.campaign_id, c);
    }
    return by;
  }, [messages]);
  const templates = useCallback((kind: TemplateKind) => [...custom.filter((t) => t.kind === kind), ...BUILTIN.filter((t) => t.kind === kind)], [custom]);
  return { campaigns, messages, custom, templates, counts, state, green, load, countsOf: (id: string) => counts.get(id) ?? zero() };
}

export function SetupNotice() {
  return (
    <div className="card p-5">
      <h2 className="font-display text-xl font-medium">נדרש עדכון חד-פעמי למסד הנתונים</h2>
      <p className="mt-2 text-muted">כדי לשלוח הזמנות ותזכורות צריך להריץ פעם אחת את הקובץ <b dir="ltr">supabase/migrations/0002_whatsapp.sql</b> ב-SQL Editor של Supabase. אחרי ההרצה רעננו את העמוד.</p>
    </div>
  );
}
export function GreenNotice({ green }: { green: boolean | null }) {
  if (green !== false) return null;
  return <p className="notice notice-warn mb-3">החיבור ל-WhatsApp (Green API) עדיין לא הוגדר בשרת. הודעות ייכנסו לתור ויחכו, ושום דבר לא יישלח עד שיוגדר.</p>;
}

/** Sample guest for previews when nobody is selected. */
export const SAMPLE = { family_name: 'משפחת ישראלי', contact_name: 'ישראל', invite_token: '' } as Pick<Guest, 'family_name' | 'contact_name' | 'invite_token'>;
export function useRender(event: EventRow) {
  return useCallback((body: string, guest: Pick<Guest, 'family_name' | 'contact_name' | 'invite_token'> = SAMPLE) =>
    render(body, variables(event, guest, typeof window === 'undefined' ? '' : window.location.origin)), [event]);
}

/** Template picker, editable text, variable chips and a WhatsApp-like preview of the result. */
export function MessageEditor({ kind, templates, body, setBody, templateId, setTemplateId, previewFor, label = 'נוסח ההודעה' }: {
  kind: TemplateKind; templates: Template[]; body: string; setBody: (s: string) => void;
  templateId: string; setTemplateId: (id: string) => void; previewFor?: Pick<Guest, 'family_name' | 'contact_name' | 'invite_token'>; label?: string;
}) {
  const { event } = useEvent();
  const rr = useRender(event);
  const area = useRef<HTMLTextAreaElement>(null);
  const { text, missing } = rr(body, previewFor);
  const insert = (k: string) => {
    const el = area.current, tag = `{{${k}}}`;
    if (!el) return setBody(body + tag);
    const at = el.selectionStart ?? body.length;
    setBody(body.slice(0, at) + tag + body.slice(el.selectionEnd ?? at));
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = at + tag.length; });
  };
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="grid min-w-0 content-start gap-3">
        {templates.length > 0 && (
          <Field label={kind === 'invite' ? 'תבנית הזמנה' : 'תבנית תזכורת'}>
            <select className="field" data-testid="template" value={templateId} onChange={(e) => { const t = templates.find((x) => x.id === e.target.value); setTemplateId(e.target.value); if (t) setBody(t.body); }}>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.builtin ? '' : ' (שלי)'}{t.is_default ? ' · ברירת מחדל' : ''}</option>)}
            </select>
          </Field>
        )}
        <Field label={label} hint="אפשר לערוך את הנוסח לפני השליחה. הערכים בסוגריים מתמלאים לבד לכל אורח.">
          <textarea ref={area} className="field min-h-56 leading-relaxed" data-testid="body" maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-1.5" aria-label="הוספת משתנה">
          {VARIABLES.map((v) => <button key={v.key} type="button" className="rounded-full border border-line bg-white px-2.5 py-1 text-xs font-semibold hover:bg-paper" onClick={() => insert(v.key)}>{v.label}</button>)}
        </div>
      </div>
      <div className="min-w-0">
        <span className="label">כך זה ייראה ב-WhatsApp{previewFor ? ` · ${previewFor.contact_name || previewFor.family_name}` : ''}</span>
        <div className="rounded-2xl bg-[#e7ddd3] p-3" data-testid="wa-preview">
          <div className="ms-auto max-w-[92%] whitespace-pre-wrap [overflow-wrap:anywhere] rounded-xl rounded-ss-sm bg-[#d9fdd3] px-3 py-2 text-[15px] leading-relaxed text-[#111b21] shadow-sm" dir="auto">{text || '…'}</div>
        </div>
        {missing.length > 0 && <p role="alert" className="notice notice-bad mt-2">חסר ערך עבור: {missing.map(variableLabel).join(', ')}. ההודעה לא תישלח כך.</p>}
      </div>
    </div>
  );
}

export async function campaignAction(id: string, action: 'pause' | 'resume' | 'cancel' | 'retry') {
  const r = await fetch(`/api/admin/campaigns/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
  return r.ok;
}

/** History of send-outs with live counts and the actions each state allows. */
export function CampaignList({ kind, box, empty }: { kind: Campaign['kind']; box: ReturnType<typeof useOutbox>; empty: string }) {
  const { canEdit } = useEvent();
  const toast = useToast();
  const [open, setOpen] = useState<Campaign | null>(null);
  const list = box.campaigns.filter((c) => c.kind === kind);
  const act = async (c: Campaign, a: Parameters<typeof campaignAction>[1], done: string) => { toast((await campaignAction(c.id, a)) ? done : 'הפעולה נכשלה', undefined); await box.load(); };
  const rows = open ? box.messages.filter((m) => m.campaign_id === open.id) : [];
  const exportCsv = (c: Campaign) => download(new Blob([toCsv([['שם', 'טלפון', 'סטטוס', 'נשלחה ב', 'הערה'],
    ...box.messages.filter((m) => m.campaign_id === c.id).map((m) => [m.name ?? '', m.phone, MESSAGE_STATUS[m.status], m.sent_at ? fmtWhen(m.sent_at) : '', m.error ?? ''])])], { type: 'text/csv;charset=utf-8' }), `${c.name}.csv`);
  if (!list.length) return <p className="card p-5 text-muted">{empty}</p>;
  return (
    <>
      <div className="grid gap-2" data-testid={`campaigns-${kind}`}>
        {list.map((c) => {
          const n = box.countsOf(c.id);
          return (
            <article key={c.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold">{c.name}</h3>
                  <p className="text-xs text-muted">{c.template_name ? `${c.template_name} · ` : ''}{c.kind === 'reminder' && c.scheduled_at ? `מועד: ${fmtWhen(c.scheduled_at)}` : `נוצר: ${fmtWhen(c.created_at)}`}{c.finished_at ? ` · הסתיים: ${fmtWhen(c.finished_at)}` : ''}</p>
                  {c.note && <p className="mt-1 text-xs font-semibold text-no">{c.note}</p>}
                </div>
                <span className={`pill ${c.status === 'done' ? 'pill-attending' : c.status === 'cancelled' ? 'pill-declined' : c.status === 'sending' ? 'pill-maybe' : 'pill-pending'}`}>{CAMPAIGN_STATUS[c.status]}</span>
              </div>
              <dl className="mt-3 grid grid-cols-4 gap-2 text-center text-sm">
                {([['נמענים', n.total], ['נשלחו', n.sent], ['ממתינות', n.pending], ['נכשלו', n.failed]] as const).map(([l, v]) => (
                  <div key={l} className="rounded-lg bg-paper px-1 py-2"><dd className="text-xl font-semibold tabular-nums">{v}</dd><dt className="text-xs text-muted">{l}</dt></div>
                ))}
              </dl>
              {n.skipped > 0 && <p className="mt-2 text-xs text-muted">{n.skipped} דולגו (שינוי סטטוס, ביטול או בקשה לא לקבל הודעות).</p>}
              <div className="mt-3 flex flex-wrap gap-1.5">
                <button className="btn btn-ghost btn-sm" onClick={() => setOpen(c)}>פירוט הנמענים</button>
                {n.total > 0 && <button className="btn btn-ghost btn-sm" onClick={() => exportCsv(c)}>ייצוא התוצאות</button>}
                {canEdit && <>
                  {(c.status === 'sending' || c.status === 'scheduled') && <button className="btn btn-ghost btn-sm" onClick={() => act(c, 'pause', 'הושהה')}>השהיה</button>}
                  {c.status === 'paused' && <button className="btn btn-ghost btn-sm" onClick={() => act(c, 'resume', 'ממשיכים')}>המשך</button>}
                  {n.failed > 0 && c.status !== 'cancelled' && <button className="btn btn-ghost btn-sm" onClick={() => act(c, 'retry', 'ההודעות שנכשלו חזרו לתור')}>שליחה חוזרת לנכשלות</button>}
                  {['sending', 'scheduled', 'paused'].includes(c.status) && <button className="btn btn-danger btn-sm" onClick={() => act(c, 'cancel', 'בוטל')}>ביטול</button>}
                </>}
              </div>
            </article>
          );
        })}
      </div>
      {open && (
        <Modal title={open.name} onClose={() => setOpen(null)} wide>
          {!rows.length ? <p className="text-muted">{open.status === 'scheduled' ? 'הנמענים ייבחרו ברגע השליחה, לפי מי שמסומן אז כמגיע.' : 'אין נמענים.'}</p> : (
            <ul className="grid gap-1.5 text-sm">{rows.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-1.5">
                <span><b>{m.name}</b> <span className="text-muted" dir="ltr">{m.phone}</span></span>
                <span className={`pill ${m.status === 'sent' ? 'pill-attending' : m.status === 'failed' ? 'pill-declined' : m.status === 'skipped' ? 'pill-pending' : 'pill-maybe'}`}>{MESSAGE_STATUS[m.status]}</span>
                {m.error && m.status !== 'sent' && <span className="basis-full text-xs text-muted">{m.error}</span>}
              </li>
            ))}</ul>
          )}
        </Modal>
      )}
    </>
  );
}

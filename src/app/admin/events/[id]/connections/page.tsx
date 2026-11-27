'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useEvent } from '@/components/admin/EventContext';
import { PageHead } from '@/components/admin/Shell';
import { Field, dbError, fmtDateTime, useToast } from '@/components/admin/ui';
import { normPhone } from '@/lib/phone';
import type { Integration } from '@/lib/types';

function State({ it, ready }: { it: Integration; ready: boolean }) {
  if (!it.enabled) return <span className="pill pill-pending">כבוי</span>;
  if (!ready) return <span className="pill pill-maybe">לא מחובר</span>;
  if (it.last_status === 'ok') return <span className="pill pill-attending">פעיל · נשלח {fmtDateTime(it.last_sent_at)}</span>;
  if (it.last_status) return <span className="pill pill-declined">השליחה האחרונה נכשלה</span>;
  return <span className="pill pill-pending">מוגדר, עוד לא נבדק</span>;
}

export default function ConnectionsPage() {
  const { event, isOwner } = useEvent();
  const toast = useToast();
  const db = supabaseBrowser();
  const [list, setList] = useState<Integration[]>([]);
  const [conn, setConn] = useState<{ ready: boolean; source: 'env' | 'db' | null; instance: string | null; state: string | null }>({ ready: false, source: null, instance: null, state: null });
  const greenReady = conn.ready;
  const [creds, setCreds] = useState({ instance: '', token: '', url: '' });
  const [credMsg, setCredMsg] = useState<{ ok: boolean; text: string; setup?: boolean } | null>(null);
  const [openForm, setOpenForm] = useState(false);
  const [busy, setBusy] = useState('');
  const [hook, setHook] = useState({ name: '', url: '', secret: '' });
  const [rcpt, setRcpt] = useState({ name: '', phone: '' });

  const load = useCallback(async () => {
    const { data } = await db.from('integrations').select('*').eq('event_id', event.id).order('created_at');
    setList((data as Integration[]) ?? []);
  }, [db, event.id]);
  useEffect(() => {
    void load();
    void loadConn();
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  async function loadConn() {
    const j = await fetch(`/api/admin/integrations?event=${event.id}&check=1`).then((r) => r.json()).catch(() => null);
    if (j?.ok) setConn({ ready: !!j.greenApiConfigured, source: j.source, instance: j.instance, state: j.state });
  }
  async function connect(e: React.FormEvent) {
    e.preventDefault(); setBusy('connect'); setCredMsg(null);
    const r = await fetch('/api/admin/green', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId: event.id, instance: creds.instance.trim(), token: creds.token.trim(), url: creds.url.trim() || undefined }) }).then((x) => x.json()).catch(() => null);
    setBusy('');
    if (!r?.ok) return setCredMsg({ ok: false, text: r?.message ?? 'החיבור נכשל. נסו שוב.', setup: !!r?.setup });
    setCreds({ instance: '', token: '', url: '' }); setOpenForm(false); setCredMsg({ ok: !!r.linked, text: r.message });
    await loadConn();
  }
  async function disconnect() {
    if (!window.confirm('לנתק את WhatsApp? הודעות שבתור יחכו עד חיבור מחדש.')) return;
    await fetch(`/api/admin/green?event=${event.id}`, { method: 'DELETE' }); setCredMsg(null); await loadConn();
  }

  if (!isOwner) return <p className="text-muted">המסך הזה פתוח לבעלי האירוע בלבד.</p>;
  const green = list.find((i) => i.type === 'greenapi');
  const hooks = list.filter((i) => i.type === 'webhook');

  async function test(it: Integration) {
    setBusy(it.id);
    const r = await fetch('/api/admin/integrations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: it.id }) }).then((x) => x.json()).catch(() => null);
    setBusy('');
    toast(r?.ok ? 'הודעת הבדיקה נשלחה' : `הבדיקה נכשלה${r?.errors?.[0] ? `: ${r.errors[0]}` : ''}`, !r?.ok);
    await load();
  }
  async function patch(it: Integration, p: Partial<Integration>) {
    const { error } = await db.from('integrations').update(p).eq('id', it.id);
    if (error) toast(dbError(error), true);
    await load();
  }
  async function addRecipient(e: React.FormEvent) {
    e.preventDefault();
    if (!normPhone(rcpt.phone)) return toast('מספר הטלפון אינו תקין.', true);
    const recipients = [...(green?.config.recipients ?? []), { name: rcpt.name.trim(), phone: rcpt.phone.trim() }];
    if (green) await patch(green, { config: { ...green.config, recipients } });
    else {
      const { error } = await db.from('integrations').insert({ event_id: event.id, type: 'greenapi', name: 'WhatsApp (Green API)', config: { recipients } });
      if (error) toast(dbError(error), true);
      await load();
    }
    setRcpt({ name: '', phone: '' });
  }
  async function addHook(e: React.FormEvent) {
    e.preventDefault();
    if (!/^https:\/\//i.test(hook.url)) return toast('כתובת ה-Webhook צריכה להתחיל ב-https://', true);
    const { error } = await db.from('integrations').insert({ event_id: event.id, type: 'webhook', name: hook.name.trim() || 'Webhook', config: { url: hook.url.trim(), secret: hook.secret.trim() || undefined } });
    if (error) return toast(dbError(error), true);
    setHook({ name: '', url: '', secret: '' }); await load(); toast('ה-Webhook נוסף. שלחו בדיקה כדי לוודא שהוא מקבל.');
  }
  async function remove(it: Integration) {
    const { error } = await db.from('integrations').delete().eq('id', it.id);
    if (error) toast(dbError(error), true);
    await load();
  }

  return (
    <>
      <PageHead title="התראות וחיבורים" sub="כל אישור הגעה, שינוי סטטוס, שינוי כמות והגעה בפועל נשלחים ליעדים שמוגדרים כאן." />
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-medium">WhatsApp דרך Green API</h2>
          {green ? <State it={green} ready={greenReady} /> : <span className="pill pill-pending">לא הוגדרו נמענים</span>}
        </div>
        <div className="mt-3 rounded-xl border border-line p-4" data-testid="green-connect">
          <div className="flex flex-wrap items-center gap-2">
            <b>חיבור החשבון</b>
            {greenReady
              ? <span className={`pill ${conn.state === 'authorized' ? 'pill-attending' : 'pill-pending'}`}>{conn.state === 'authorized' ? 'מחובר' : conn.state === 'notAuthorized' ? 'ממתין לסריקת QR' : 'פרטים שמורים'}</span>
              : <span className="pill pill-declined">לא מחובר</span>}
            {greenReady && <span className="text-sm text-muted">מופע <span dir="ltr">{conn.instance}</span>{conn.source === 'env' ? ' · מוגדר בשרת' : ''}</span>}
            {greenReady && conn.source === 'db' && <span className="ms-auto flex gap-2"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpenForm(!openForm)}>החלפה</button><button type="button" className="btn btn-danger btn-sm" onClick={disconnect}>ניתוק</button></span>}
          </div>
          {greenReady && conn.state === 'notAuthorized' && <p className="notice notice-warn mt-3">הפרטים נכונים, אבל הטלפון עוד לא מקושר. במסוף של Green API סורקים את קוד ה-QR מתוך WhatsApp בטלפון השולח (מכשירים מקושרים).</p>}
          {credMsg && <p className={`notice mt-3 ${credMsg.ok ? '' : 'notice-warn'}`} role="status">{credMsg.text}</p>}
          {(!greenReady || openForm) && conn.source !== 'env' && (
            <form onSubmit={connect} className="mt-3 grid gap-3">
              <p className="text-sm text-muted">נכנסים ל-<a className="font-medium underline" href="https://console.green-api.com" target="_blank" rel="noreferrer" dir="ltr">console.green-api.com</a>, פותחים את המופע, ומעתיקים משם את שלושת הערכים. הטוקן נשמר בשרת בלבד ולא מוצג שוב.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="מזהה המופע (idInstance)"><input className="field" dir="ltr" inputMode="numeric" autoComplete="off" required pattern="[0-9]{6,20}" value={creds.instance} onChange={(e) => setCreds({ ...creds, instance: e.target.value })} /></Field>
                <Field label="טוקן (apiTokenInstance)"><input className="field" dir="ltr" type="password" autoComplete="off" required minLength={20} value={creds.token} onChange={(e) => setCreds({ ...creds, token: e.target.value })} /></Field>
              </div>
              <Field label="כתובת ה-API (apiUrl), אם מופיעה במסוף"><input className="field" dir="ltr" inputMode="url" autoComplete="off" placeholder="https://api.green-api.com" value={creds.url} onChange={(e) => setCreds({ ...creds, url: e.target.value })} /></Field>
              <div><button className="btn" disabled={busy === 'connect'}>{busy === 'connect' ? 'בודקים מול Green API…' : 'בדיקה וחיבור'}</button></div>
            </form>
          )}
        </div>
        <h3 className="mt-5 font-medium">מי מקבל התראה על כל תשובה</h3>
        <ul className="mt-3 divide-y divide-line text-sm">
          {(green?.config.recipients ?? []).map((r, i) => (
            <li key={i} className="flex items-center gap-3 py-2"><b>{r.name || 'נמען'}</b><span dir="ltr">{r.phone}</span>
              <button className="btn btn-danger btn-sm ms-auto" onClick={() => patch(green!, { config: { ...green!.config, recipients: green!.config.recipients!.filter((_, j) => j !== i) } })}>הסרה</button></li>
          ))}
        </ul>
        <form onSubmit={addRecipient} className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="שם"><input className="field" maxLength={40} value={rcpt.name} onChange={(e) => setRcpt({ ...rcpt, name: e.target.value })} /></Field>
          <Field label="טלפון"><input className="field" dir="ltr" type="tel" required value={rcpt.phone} onChange={(e) => setRcpt({ ...rcpt, phone: e.target.value })} /></Field>
          <button className="btn btn-ghost">הוספת נמען</button>
        </form>
        {green && <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
          <button className="btn" disabled={busy === green.id || !greenReady} onClick={() => test(green)}>{busy === green.id ? 'שולחים…' : 'שליחת הודעת בדיקה'}</button>
          <button className="btn btn-ghost" onClick={() => patch(green, { enabled: !green.enabled })}>{green.enabled ? 'כיבוי ההתראות' : 'הפעלת ההתראות'}</button>
          {green.last_error && <span className="self-center text-sm text-no">שגיאה אחרונה: {green.last_error}</span>}
        </div>}
      </section>

      <section className="card mt-4 p-5">
        <h2 className="font-display text-lg font-medium">Webhooks</h2>
        <p className="mt-1 text-sm text-muted">כל אירוע נשלח כ-JSON בבקשת POST. כך מחברים Zapier, Make, Google Sheets, מערכת CRM או שירות דיוור. אם הוגדר סוד, הבקשה חתומה בכותרת <span dir="ltr">X-RSVP-Signature</span> (HMAC-SHA256).</p>
        <ul className="mt-3 divide-y divide-line text-sm">
          {hooks.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-2 py-2.5">
              <b>{h.name}</b><span dir="ltr" className="max-w-64 truncate text-muted">{h.config.url}</span><State it={h} ready />
              <div className="ms-auto flex gap-1">
                <button className="btn btn-ghost btn-sm" disabled={busy === h.id} onClick={() => test(h)}>בדיקה</button>
                <button className="btn btn-ghost btn-sm" onClick={() => patch(h, { enabled: !h.enabled })}>{h.enabled ? 'כיבוי' : 'הפעלה'}</button>
                <button className="btn btn-danger btn-sm" onClick={() => remove(h)}>מחיקה</button>
              </div>
              {h.last_error && <div className="w-full text-xs text-no">שגיאה אחרונה: {h.last_error}</div>}
            </li>
          ))}
          {!hooks.length && <li className="py-2 text-muted">עדיין לא חובר אף Webhook.</li>}
        </ul>
        <form onSubmit={addHook} className="mt-3 grid gap-2 lg:grid-cols-[1fr_2fr_1fr_auto] lg:items-end">
          <Field label="שם"><input className="field" maxLength={40} placeholder="Make / Zapier" value={hook.name} onChange={(e) => setHook({ ...hook, name: e.target.value })} /></Field>
          <Field label="כתובת"><input className="field" dir="ltr" type="url" required placeholder="https://" value={hook.url} onChange={(e) => setHook({ ...hook, url: e.target.value })} /></Field>
          <Field label="סוד לחתימה (לא חובה)"><input className="field" dir="ltr" maxLength={100} value={hook.secret} onChange={(e) => setHook({ ...hook, secret: e.target.value })} /></Field>
          <button className="btn btn-ghost">הוספת Webhook</button>
        </form>
      </section>
    </>
  );
}

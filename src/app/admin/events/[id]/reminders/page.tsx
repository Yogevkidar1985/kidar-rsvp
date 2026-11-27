'use client';
import { useEffect, useMemo, useState } from 'react';
import { useEvent } from '@/components/admin/EventContext';
import { PageHead } from '@/components/admin/Shell';
import { Field, Modal, useToast } from '@/components/admin/ui';
import { CampaignList, GreenNotice, MessageEditor, SetupNotice, useOutbox, useRender } from '@/components/admin/outbox';
import { eventStart, fmtWhen, wallTime } from '@/lib/when';
import { normPhone } from '@/lib/phone';

const OFFSETS = [24, 12, 6, 3, 1];
const offsetLabel = (h: number) => (h === 24 ? '24 שעות לפני (יום לפני)' : h === 1 ? 'שעה לפני' : `${h} שעות לפני`);

export default function RemindersPage() {
  const { event, guests, canEdit } = useEvent();
  const toast = useToast();
  const box = useOutbox();
  const rr = useRender(event);
  const templates = box.templates('reminder');
  const [templateId, setTemplateId] = useState('');
  const [body, setBody] = useState('');
  const [hours, setHours] = useState<number[]>([24]);
  const [custom, setCustom] = useState({ on: false, date: '', time: '' });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [who, setWho] = useState(false);

  useEffect(() => {
    if (templateId || !templates.length) return;
    const t = templates.find((x) => x.is_default) ?? templates[0];
    setTemplateId(t.id); setBody(t.body);
  }, [templates, templateId]);

  const start = useMemo(() => eventStart(event), [event]);
  const eligible = useMemo(() => guests.filter((g) => g.status === 'attending' && g.reminders_enabled !== false && !g.opted_out && normPhone(g.phone)), [guests]);
  const attending = guests.filter((g) => g.status === 'attending');
  const excluded = guests.length - eligible.length;
  const times = useMemo(() => {
    if (!start) return [];
    const list = hours.map((h) => ({ label: offsetLabel(h), at: new Date(start.getTime() - h * 3600000) }));
    const c = custom.on && custom.date && custom.time ? wallTime(custom.date, custom.time) : null;
    if (c) list.push({ label: 'מועד מותאם', at: c });
    return list.sort((a, b) => a.at.getTime() - b.at.getTime());
  }, [start, hours, custom]);
  const now = Date.now();
  const problems = times.filter((t) => t.at.getTime() <= now || (start && t.at >= start));
  const { missing } = rr(body, eligible[0]);
  const next = box.campaigns.filter((c) => c.kind === 'reminder' && c.status === 'scheduled' && c.scheduled_at).sort((a, b) => a.scheduled_at!.localeCompare(b.scheduled_at!))[0];
  const ready = !!start && times.length > 0 && !problems.length && !missing.length && !!body.trim();

  async function schedule() {
    setBusy(true);
    let ok = 0; const errors: string[] = [];
    for (const t of times) {
      const r = await fetch('/api/admin/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        eventId: event.id, kind: 'reminder', name: `תזכורת · ${t.label}`, templateName: templates.find((x) => x.id === templateId)?.name ?? null, body, scheduledAt: t.at.toISOString() }) });
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok) ok++; else errors.push(j?.message ?? 'שגיאה');
    }
    setBusy(false); setConfirm(false);
    toast(errors.length ? `${ok} תוזמנו. ${errors[0]}` : `${ok} תזכורות תוזמנו`, !!errors.length);
    await box.load();
  }
  async function test() {
    const r = await fetch('/api/admin/campaigns/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId: event.id, body }) });
    const j = await r.json().catch(() => null);
    toast(j?.ok ? `הודעת בדיקה נשלחה ל-${j.sent} מספרים של המארחים` : j?.message ?? 'הבדיקה נכשלה', !j?.ok);
  }

  if (box.state === 'loading') return <p className="p-6 text-muted">טוענים…</p>;
  if (box.state === 'setup') return <><PageHead title="תזכורות אוטומטיות" /><SetupNotice /></>;

  return (
    <>
      <PageHead title="תזכורות אוטומטיות" sub="נשלחות רק למי שאישרו הגעה, ונבדקות שוב רגע לפני השליחה" />
      <GreenNotice green={box.green} />
      <dl className="mb-4 grid grid-cols-2 gap-2 text-center sm:grid-cols-4" data-testid="reminder-totals">
        <div className="card stat col-span-2 text-start sm:col-span-1"><dt>התזכורת הבאה</dt><dd className="!text-lg !leading-snug">{next ? fmtWhen(next.scheduled_at!) : 'לא תוזמנה'}</dd></div>
        <div className="card stat text-start"><dt>יקבלו תזכורת</dt><dd>{eligible.length}</dd></div>
        <div className="card stat text-start"><dt>מגיעים בלי תזכורת</dt><dd>{attending.length - eligible.length}</dd></div>
        <div className="card stat text-start"><dt>לא אישרו הגעה</dt><dd>{guests.length - attending.length}</dd></div>
      </dl>
      {!start && <p className="notice notice-warn mb-3">לאירוע אין עדיין תאריך ושעה. מגדירים אותם ב"עיצוב ההזמנה", בלשונית "מועד".</p>}

      <fieldset disabled={!canEdit || !start} className="grid gap-4">
        <section className="card p-4">
          <h2 className="font-display text-lg font-medium">1. מתי לשלוח</h2>
          {start && <p className="mt-1 text-sm text-muted">האירוע מתחיל ב-{fmtWhen(start)} (שעון ישראל).</p>}
          <div className="mt-3 grid gap-2 sm:grid-cols-2" data-testid="offsets">
            {OFFSETS.map((h) => {
              const at = start ? new Date(start.getTime() - h * 3600000) : null;
              return (
                <label key={h} className="flex min-h-12 items-center gap-3 rounded-xl border border-line px-3 py-2">
                  <input type="checkbox" className="h-5 w-5" checked={hours.includes(h)} onChange={(e) => setHours((l) => (e.target.checked ? [...l, h] : l.filter((x) => x !== h)))} />
                  <span><b className="block text-sm">{offsetLabel(h)}</b>{at && <span className="text-xs text-muted">{fmtWhen(at)}</span>}</span>
                </label>
              );
            })}
            <label className="flex min-h-12 items-center gap-3 rounded-xl border border-line px-3 py-2">
              <input type="checkbox" className="h-5 w-5" checked={custom.on} onChange={(e) => setCustom({ ...custom, on: e.target.checked })} />
              <b className="text-sm">תאריך ושעה אחרים</b>
            </label>
          </div>
          {custom.on && <div className="mt-2 grid grid-cols-2 gap-2 sm:max-w-sm">
            <Field label="תאריך"><input className="field" type="date" value={custom.date} onChange={(e) => setCustom({ ...custom, date: e.target.value })} /></Field>
            <Field label="שעה (שעון ישראל)"><input className="field" type="time" value={custom.time} onChange={(e) => setCustom({ ...custom, time: e.target.value })} /></Field>
          </div>}
          {problems.length > 0 && <p role="alert" className="mt-2 text-sm font-semibold text-no">{problems.map((p) => p.label).join(', ')}: המועד כבר עבר או שהוא אחרי תחילת האירוע.</p>}
        </section>

        <section className="card p-4">
          <h2 className="mb-3 font-display text-lg font-medium">2. נוסח התזכורת</h2>
          <MessageEditor kind="reminder" templates={templates} body={body} setBody={setBody} templateId={templateId} setTemplateId={setTemplateId} previewFor={eligible[0]} label="נוסח התזכורת" />
        </section>

        <section className="card grid gap-3 p-4">
          <h2 className="font-display text-lg font-medium">3. הפעלה</h2>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn" disabled={!ready} onClick={() => setConfirm(true)}>המשך לאישור</button>
            <button type="button" className="btn btn-ghost" disabled={!!missing.length || !body.trim()} onClick={test}>שליחת בדיקה למארחים</button>
            <button type="button" className="btn btn-ghost" onClick={() => setWho(true)}>מי יקבל ({eligible.length})</button>
          </div>
          <p className="text-xs text-muted">מי שישנה את התשובה שלו עד מועד השליחה יוסר או יתווסף לבד. את התזכורת לאורח מסוים מכבים בעמוד "מוזמנים".</p>
        </section>
      </fieldset>

      <h2 className="mb-2 mt-6 font-display text-lg font-medium">תזכורות שתוזמנו</h2>
      <CampaignList kind="reminder" box={box} empty="עדיין לא תוזמנו תזכורות." />

      {confirm && (
        <Modal title="אישור הפעלת התזכורות" onClose={() => setConfirm(false)}>
          <ul className="grid gap-2">{times.map((t) => <li key={t.at.toISOString()} className="rounded-lg bg-paper px-3 py-2"><b className="block text-sm">{t.label}</b><span className="text-sm text-muted">{fmtWhen(t.at)}</span></li>)}</ul>
          <p className="mt-3">נכון לעכשיו: <b>{eligible.length}</b> אורחים שאישרו הגעה יקבלו את התזכורת.</p>
          <p className="text-sm text-muted">{excluded} לא יקבלו: לא אישרו הגעה, אין להם טלפון, או שהתזכורות כבויות אצלם.</p>
          <div className="mt-4 flex gap-2"><button className="btn" disabled={busy} onClick={schedule}>{busy ? 'מתזמנים…' : 'הפעלת התזכורות'}</button><button className="btn btn-ghost" onClick={() => setConfirm(false)}>ביטול</button></div>
        </Modal>
      )}
      {who && (
        <Modal title={`יקבלו תזכורת (${eligible.length})`} onClose={() => setWho(false)}>
          {!eligible.length ? <p className="text-muted">אף אחד עדיין לא אישר הגעה.</p> : <ul className="grid gap-1 text-sm">{eligible.map((g) => <li key={g.id} className="flex justify-between gap-2 border-b border-line pb-1"><b>{g.family_name}</b><span className="text-muted" dir="ltr">{g.phone}</span></li>)}</ul>}
        </Modal>
      )}
    </>
  );
}

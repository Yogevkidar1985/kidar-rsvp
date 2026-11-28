'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEvent } from '@/components/admin/EventContext';
import { PageHead } from '@/components/admin/Shell';
import { fmtDateTime, useToast } from '@/components/admin/ui';
import { VersionsList } from '@/components/admin/Versions';
import { refreshPublic } from '@/lib/refresh-public';
import { versions, type Archived } from '@/lib/versions';
import { STATUS_LABEL } from '@/lib/types';
import type { EventRow, GuestStatus } from '@/lib/types';

type Backup = { format: string; exported_at?: string; event_id: string; event?: Record<string, unknown>; guests?: Record<string, unknown>[]; tables?: unknown[] };

export default function BackupPage() {
  const { event, setEvent, guests, canEdit, reload } = useEvent();
  const toast = useToast();
  const [gone, setGone] = useState<Archived[] | null>(null);
  const [busy, setBusy] = useState('');
  const [stamp, setStamp] = useState(0);
  const [file, setFile] = useState<{ name: string; data: Backup; missing: number } | null>(null);
  const [parts, setParts] = useState<{ event: boolean; guests: boolean }>({ event: false, guests: true });
  const input = useRef<HTMLInputElement>(null);
  const loadGone = useCallback(async () => setGone(await versions.archive(event.id)), [event.id]);
  useEffect(() => { void loadGone(); }, [loadGone, guests.length]);

  async function bring(g: Archived) {
    setBusy(g.id);
    const r = await versions.restoreGuest(event.id, g.id);
    setBusy('');
    if (!r.ok) return toast(r.message ?? 'לא הצלחנו להחזיר.', true);
    toast(`${g.family_name} חזרה לרשימת המוזמנים`); await reload(); await loadGone();
  }
  async function pick(list: FileList | null) {
    const f = list?.[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text()) as Backup;
      if (data?.format !== 'kidar-rsvp-backup') throw new Error('format');
      if (data.event_id !== event.id) return toast('הקובץ הזה הוא גיבוי של אירוע אחר.', true);
      const have = new Set(guests.map((g) => g.id));
      setFile({ name: f.name, data, missing: (data.guests ?? []).filter((g) => !have.has(String(g.id))).length });
    } catch { toast('זה לא קובץ גיבוי של המערכת.', true); }
    finally { if (input.current) input.current.value = ''; }
  }
  async function apply() {
    if (!file) return;
    const want = (['event', 'guests'] as const).filter((p) => parts[p]);
    if (!want.length) return toast('סמנו מה לשחזר מהקובץ.', true);
    if (parts.event && !window.confirm('הטקסטים והעיצוב של ההזמנה יוחלפו במה שבקובץ. הגרסה הנוכחית נשמרת לפני כן. להמשיך?')) return;
    setBusy('import');
    const r = await versions.importFile(event.id, file.data, want);
    setBusy('');
    if (!r.ok) return toast(r.message ?? 'השחזור מהקובץ נכשל.', true);
    toast([r.event ? 'ההזמנה שוחזרה' : '', r.added !== undefined ? `${r.added} משפחות חזרו לרשימה` : '', r.skipped ? `${r.skipped} לא נוספו` : ''].filter(Boolean).join(' · ') || 'לא היה מה לשחזר');
    setFile(null); setStamp((n) => n + 1); await reload();
    if (r.event) { void refreshPublic(event.id, event.slug); window.location.reload(); }
  }

  return (
    <>
      <PageHead title="גרסאות וגיבוי" sub="כל שינוי אפשר להחזיר: גרסאות של ההזמנה, של סידור ההושבה, משפחות שנמחקו וקובץ גיבוי מלא" />

      <section className="card mb-4 p-4" data-testid="backup-file">
        <h2 className="mb-1 font-display text-lg font-medium">גיבוי מלא לקובץ</h2>
        <p className="mb-3 text-sm text-muted">קובץ אחד עם ההזמנה, כל המוזמנים והתשובות שלהם, השולחנות, התמונות (כקישורים) ותבניות ההודעות. אין בו מפתחות, סיסמאות או פרטי חיבור. שמרו אותו במקום פרטי: יש בו שמות וטלפונים.</p>
        <div className="flex flex-wrap gap-2">
          <a className="btn" href={`/api/admin/backup?event=${event.id}`} download data-testid="backup-download">הורדת גיבוי עכשיו</a>
          {canEdit && <button type="button" className="btn btn-ghost" onClick={() => input.current?.click()}>שחזור מקובץ גיבוי</button>}
          <input ref={input} type="file" accept="application/json,.json" className="sr-only" aria-label="קובץ גיבוי" onChange={(e) => pick(e.target.files)} />
        </div>
        {file && (
          <div className="notice mt-3" data-testid="backup-import">
            <p className="mb-2"><b>{file.name}</b>{file.data.exported_at ? ` · נוצר ב-${fmtDateTime(file.data.exported_at)}` : ''} · {(file.data.guests ?? []).length} משפחות בקובץ, מהן {file.missing} שלא נמצאות היום ברשימה.</p>
            <label className="flex items-center gap-2 py-1"><input type="checkbox" checked={parts.guests} onChange={(e) => setParts((p) => ({ ...p, guests: e.target.checked }))} />להחזיר את {file.missing} המשפחות החסרות (משפחות שקיימות לא משתנות)</label>
            <label className="flex items-center gap-2 py-1"><input type="checkbox" checked={parts.event} onChange={(e) => setParts((p) => ({ ...p, event: e.target.checked }))} />להחזיר את הטקסטים והעיצוב של ההזמנה כפי שהיו בקובץ</label>
            <div className="mt-2 flex gap-2"><button type="button" className="btn" disabled={busy === 'import'} onClick={apply}>{busy === 'import' ? 'משחזרים…' : 'שחזור'}</button><button type="button" className="btn btn-ghost" onClick={() => setFile(null)}>ביטול</button></div>
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4">
          <h2 className="mb-1 font-display text-lg font-medium">גרסאות ההזמנה</h2>
          <p className="mb-3 text-sm text-muted">טקסטים, מועד, מקום, צבעים, גדלים ואנימציות. כתובת ההזמנה ומצב הפרסום לא משתנים בשחזור.</p>
          <VersionsList eventId={event.id} kind="event" canEdit={canEdit} stamp={stamp}
            onRestored={(r) => { if (r.event) { setEvent(r.event as unknown as EventRow); void refreshPublic(event.id, event.slug); } }} />
        </section>
        <section className="card p-4">
          <h2 className="mb-1 font-display text-lg font-medium">גרסאות סידור ההושבה</h2>
          <p className="mb-3 text-sm text-muted">השולחנות, המיקום שלהם באולם ומי יושב איפה. נשמרת גרסה לפני כל שינוי בסידור.</p>
          <VersionsList eventId={event.id} kind="seating" canEdit={canEdit} stamp={stamp} onRestored={() => { void reload(); }} />
        </section>
      </div>

      <section className="card mt-4 p-4" data-testid="archive">
        <h2 className="mb-1 font-display text-lg font-medium">משפחות שנמחקו או אוחדו</h2>
        <p className="mb-3 text-sm text-muted">שום משפחה לא נמחקת לגמרי: אפשר להחזיר אותה לרשימה עם התשובה, ההעדפות והקישור האישי שלה.</p>
        {gone === null ? <p className="text-sm text-muted">טוענים…</p> : !gone.length ? <p className="text-sm text-muted">אין כאן אף משפחה. משפחה שתימחק או תאוחד תופיע כאן.</p> : (
          <ul className="ver-list">
            {gone.map((g) => (
              <li key={g.id}>
                <div className="ver-what"><b>{g.family_name}</b>
                  <span>{g.why === 'merged' ? `אוחדה${g.into ? ` לתוך ${g.into}` : ''}` : 'נמחקה'} ב-{fmtDateTime(g.at)} · {STATUS_LABEL[g.status as GuestStatus] ?? g.status}{g.people ? ` · ${g.people} אנשים` : ''}{g.phone ? <> · <bdi dir="ltr">{g.phone}</bdi></> : null}</span></div>
                <div className="ver-acts">{canEdit && <button type="button" className="btn btn-ghost btn-sm" disabled={busy === g.id} onClick={() => bring(g)}>{busy === g.id ? 'מחזירים…' : 'החזרה לרשימה'}</button>}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

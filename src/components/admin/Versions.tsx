'use client';
import { useCallback, useEffect, useState } from 'react';
import { fmtDateTime, useToast } from '@/components/admin/ui';
import { versions, type Version } from '@/lib/versions';

/** Saved copies of the invitation or of the seating plan: newest first, each one a point to go back to. */
export function VersionsList({ eventId, kind, canEdit, stamp = 0, onLoad, onRestored }: {
  eventId: string; kind: 'event' | 'seating'; canEdit: boolean; stamp?: number;
  /** The editor shows a version in the preview before anything is saved. */
  onLoad?: (data: Record<string, unknown>, v: Version) => void;
  onRestored?: (r: { event?: Record<string, unknown>; seated?: number; skipped?: number }) => void;
}) {
  const toast = useToast();
  const [list, setList] = useState<Version[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<number | 'save' | null>(null);
  const load = useCallback(async () => setList(await versions.list(eventId, kind)), [eventId, kind]);
  useEffect(() => { void load(); }, [load, stamp]);

  async function keep(e: React.FormEvent) {
    e.preventDefault();
    setBusy('save');
    const r = await versions.snapshot(eventId, kind, name.trim() || 'נקודת שחזור', false);
    setBusy(null);
    if (!r.ok) return toast(r.message ?? 'לא הצלחנו לשמור.', true);
    setName(''); toast('נקודת השחזור נשמרה'); await load();
  }
  async function restore(v: Version) {
    if (!window.confirm(kind === 'seating'
      ? `להחזיר את סידור ההושבה למצב מ-${fmtDateTime(v.at)}? המצב הנוכחי נשמר לפני כן, כך שאפשר לחזור גם אליו.`
      : `להחזיר את ההזמנה לגרסה מ-${fmtDateTime(v.at)}? הגרסה הנוכחית נשמרת לפני כן, כך שאפשר לחזור גם אליה.`)) return;
    setBusy(v.id);
    const r = await versions.restore(eventId, v.id);
    setBusy(null);
    if (!r.ok) return toast(r.message ?? 'השחזור נכשל.', true);
    toast(kind === 'seating' ? (r.skipped ? `הסידור שוחזר. ${r.skipped} משפחות לא שובצו כי השתנו מאז.` : 'סידור ההושבה שוחזר') : 'ההזמנה שוחזרה');
    onRestored?.(r); await load();
  }
  async function show(v: Version) {
    setBusy(v.id);
    const full = await versions.get(eventId, v.id);
    setBusy(null);
    if (!full?.data) return toast('הגרסה לא נמצאה.', true);
    onLoad?.(full.data, v);
  }
  async function drop(v: Version) {
    if (!window.confirm('למחוק את נקודת השחזור הזו? אי אפשר להחזיר אותה.')) return;
    await versions.remove(eventId, v.id); await load();
  }

  return (
    <div className="ver" data-testid={`versions-${kind}`}>
      {canEdit && (
        <form className="ver-keep" onSubmit={keep}>
          <label className="grow"><span className="sr-only">שם לנקודת השחזור</span>
            <input className="field" maxLength={80} placeholder={kind === 'seating' ? 'למשל: לפני שינויים של הרגע האחרון' : 'למשל: הנוסח שאהבנו'} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <button className="btn" disabled={busy === 'save'}>{busy === 'save' ? 'שומרים…' : 'שמירת נקודת שחזור'}</button>
        </form>
      )}
      {list === null ? <p className="text-sm text-muted">טוענים…</p> : !list.length ? (
        <p className="text-sm text-muted">עדיין אין גרסאות שמורות. גרסה נשמרת לבד בכל שמירה{kind === 'seating' ? ' ולפני כל שינוי בסידור' : ''}, ואפשר לשמור נקודת שחזור בשם משלכם.</p>
      ) : (
        <ul className="ver-list">
          {list.map((v, i) => (
            <li key={v.id}>
              <div className="ver-what">
                <b>{v.label || 'גרסה'}</b>
                <span>{fmtDateTime(v.at)}{v.summary && kind === 'seating' ? ` · ${v.summary}` : ''}</span>
              </div>
              <span className={`pill ${v.auto ? 'pill-pending' : 'pill-attending'}`}>{i === 0 && v.auto && kind === 'event' ? 'אחרונה' : v.auto ? 'אוטומטית' : 'שמורה'}</span>
              <div className="ver-acts">
                {onLoad && <button type="button" className="btn btn-ghost btn-sm" disabled={busy === v.id} onClick={() => show(v)}>הצגה בתצוגה</button>}
                {canEdit && !onLoad && <button type="button" className="btn btn-ghost btn-sm" disabled={busy === v.id} onClick={() => restore(v)}>{busy === v.id ? 'משחזרים…' : 'שחזור'}</button>}
                {canEdit && !v.auto && <button type="button" className="btn btn-ghost btn-sm" aria-label={`מחיקת ${v.label}`} onClick={() => drop(v)}>×</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

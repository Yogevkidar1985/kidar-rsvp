'use client';
import { useMemo, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useEvent } from '@/components/admin/EventContext';
import { PageHead } from '@/components/admin/Shell';
import { Field, dbError, useToast } from '@/components/admin/ui';
import { resolveDesign } from '@/lib/defaults';
import { inviteUrl, shortLink } from '@/lib/templates';
import { LINK_CODE, SLUG, randomCode } from '@/lib/links';
import { refreshPublic } from '@/lib/refresh-public';
import type { EventRow, Guest } from '@/lib/types';

/** Everything about the links that are sent: the invitation's address, how a link looks inside WhatsApp, and each family's own link. */
export default function LinksPage() {
  const { event, setEvent, guests, canEdit, reload } = useEvent();
  const toast = useToast();
  const db = supabaseBrowser();
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const host = origin.replace(/^https?:\/\//, '');
  const design = useMemo(() => resolveDesign(event.design), [event.design]);

  const [slug, setSlug] = useState(event.slug);
  const [share, setShare] = useState(design.share);
  const [short, setShort] = useState(design.shortUrl);
  const shortNow = shortLink(design.shortUrl);
  const [busy, setBusy] = useState('');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<{ id: string; code: string } | null>(null);
  const [stamp, setStamp] = useState(0); // a new preview picture is fetched after a save

  const autoTitle = event.hosts ? `${event.hosts} · ${event.name}` : event.name;
  const autoDesc = [event.headline, event.weekday_label, event.hebrew_date, event.reception_time || event.ceremony_time].filter(Boolean).join(' · ');
  const sent = guests.filter((g) => g.invited_at).length;
  const slugOk = SLUG.test(slug);
  const shown = useMemo(() => { const s = q.trim(); return s ? guests.filter((g) => `${g.family_name} ${g.contact_name ?? ''} ${g.link_code ?? ''}`.includes(s)) : guests; }, [guests, q]);

  async function copy(text: string, what = 'הקישור') {
    try { await navigator.clipboard.writeText(text); toast(`${what} הועתק`); } catch { toast('ההעתקה נחסמה. סמנו את הקישור והעתיקו ידנית.', true); }
  }
  async function saveEvent(patch: Partial<EventRow>, key: string, done: string) {
    setBusy(key);
    const { data, error } = await db.from('events').update(patch).eq('id', event.id).select('*').single();
    setBusy('');
    if (error || !data) return toast(error?.code === '23505' ? 'הכתובת הזו כבר תפוסה. בחרו אחרת.' : dbError(error), true);
    setEvent(data as EventRow); setStamp(Date.now()); await refreshPublic(event.id, event.slug); toast(done);
  }
  async function saveSlug() {
    if (!slugOk || slug === event.slug) return;
    if (sent && !window.confirm(`${sent} משפחות כבר קיבלו הזמנה עם הכתובת הנוכחית. אחרי השינוי הקישורים שנשלחו להן יפסיקו לעבוד, ותצטרכו לשלוח להן קישור חדש. לשנות בכל זאת?`)) return;
    await saveEvent({ slug }, 'slug', 'כתובת ההזמנה עודכנה');
  }
  async function saveCode(g: Guest, code: string) {
    if (!LINK_CODE.test(code)) return toast('4 עד 24 תווים: אותיות באנגלית, ספרות ומקף.', true);
    if (g.invited_at && code !== g.link_code && !window.confirm(`${g.family_name} כבר קיבלו הזמנה. הקישור שנשלח להם יפסיק לזהות אותם ויפתח את ההזמנה הכללית. לשנות בכל זאת?`)) return;
    setBusy(g.id);
    const { error } = await db.from('guests').update({ link_code: code }).eq('id', g.id);
    setBusy('');
    if (error) return toast(error.code === '23505' ? 'הקוד הזה כבר שייך למשפחה אחרת.' : dbError(error), true);
    setEdit(null); await reload(); toast('הקישור האישי עודכן');
  }

  return (
    <>
      <PageHead title="קישורים" sub="הכתובת של ההזמנה, איך הקישור נראה ב-WhatsApp, והקישור האישי של כל משפחה." />

      <section className="card p-5" data-testid="link-main">
        <h2 className="font-display text-lg font-medium">הקישור להזמנה</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a className="link-chip" dir="ltr" href={`${origin}/${event.slug}`} target="_blank" rel="noreferrer">{host}/<b>{event.slug}</b></a>
          <button type="button" className="btn btn-sm" onClick={() => copy(`${origin}/${event.slug}`)}>העתקה</button>
          <a className="btn btn-ghost btn-sm" href={`${origin}/${event.slug}?test=1`} target="_blank" rel="noreferrer">פתיחה במצב בדיקה</a>
        </div>
        <form className="mt-4 grid gap-2 border-t border-line pt-4" data-testid="short-form" onSubmit={(e) => { e.preventDefault(); const v = short.trim(); if (v && !shortLink(v)) return toast('קישור קצר מתחיל ב-https ואין בו רווחים או סימני שאלה.', true); void saveEvent({ design: { ...event.design, shortUrl: v } }, 'short', v ? 'הקישור הקצר נשמר' : 'הקישור הקצר הוסר'); }}>
          <Field label="קישור קצר (לא חובה)" hint="קישור משירות קיצור שמוביל להזמנה. כשהוא מוגדר, הוא זה שמועתק מכאן ומהסקירה, והוא שנכנס להודעות WhatsApp במקום הקישור הארוך.">
            <input className="field" dir="ltr" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="https://tinyurl.com/..." aria-label="קישור קצר" data-testid="short-url" disabled={!canEdit} maxLength={120} value={short} onChange={(e) => setShort(e.target.value)} />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-sm" disabled={!canEdit || busy === 'short' || short.trim() === design.shortUrl}>{busy === 'short' ? 'שומרים…' : 'שמירה'}</button>
            {shortNow && <><a className="link-chip" dir="ltr" href={shortNow} target="_blank" rel="noreferrer" data-testid="short-now">{shortNow.replace(/^https:\/\//, '')}</a><button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(shortNow, 'הקישור הקצר')}>העתקה</button></>}
          </div>
          {shortNow && <p className="text-xs text-muted">בהודעות WhatsApp כל המשפחות מקבלות את הקישור הקצר, ולכן הן מזוהות לפי מספר הטלפון שהן ממלאות ולא לפי קישור אישי. הודעת בדיקה נשלחת עם הקישור המלא, כי רק הוא נפתח במצב בדיקה.</p>}
        </form>
        {!event.published && <p className="notice notice-warn mt-3">ההזמנה עדיין טיוטה, ולכן הקישור לא ייפתח לאורחים. מפרסמים במסך "עיצוב ההזמנה".</p>}
        <form className="mt-4 grid gap-2 border-t border-line pt-4 sm:grid-cols-[1fr_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); void saveSlug(); }}>
          <Field label="שינוי הכתובת" hint={slugOk ? 'אותיות קטנות באנגלית, ספרות ומקף. למשל kidar-brit.' : '3 עד 60 תווים: אותיות קטנות באנגלית, ספרות ומקף, בלי מקף בהתחלה.'}>
            <div className="link-edit" dir="ltr"><span>{host}/</span><input className="field" aria-label="כתובת ההזמנה" disabled={!canEdit} maxLength={60} autoCapitalize="none" autoCorrect="off" spellCheck={false} value={slug} aria-invalid={!slugOk} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} /></div>
          </Field>
          <button className="btn" disabled={!canEdit || !slugOk || slug === event.slug || busy === 'slug'}>{busy === 'slug' ? 'שומרים…' : 'שמירת הכתובת'}</button>
        </form>
        {sent > 0 && <p className="mt-2 text-xs text-warn">{sent} משפחות כבר קיבלו הזמנה. שינוי הכתובת שובר את הקישורים שנשלחו להן.</p>}
      </section>

      <section className="card mt-4 p-5" data-testid="link-preview">
        <h2 className="font-display text-lg font-medium">איך הקישור נראה ב-WhatsApp</h2>
        <p className="mt-1 text-sm text-muted">זה הכרטיס שמופיע מתחת להודעה. התמונה נבנית מתמונת ההזמנה, והטקסטים ניתנים לעריכה כאן.</p>
        <div className="mt-4 grid gap-5 md:grid-cols-[minmax(0,340px)_1fr] md:items-start">
          <div className="wa-card" aria-label="תצוגה מקדימה של הקישור">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/og/${event.slug}?v=${stamp || event.updated_at}`} alt="" />
            <div>
              <b>{share.title.trim() || autoTitle}</b>
              <span>{share.description.trim() || autoDesc}</span>
              <small dir="ltr">{host}</small>
            </div>
          </div>
          <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void saveEvent({ design: { ...event.design, share: { title: share.title.trim(), description: share.description.trim() } } as EventRow['design'] }, 'share', 'תצוגת הקישור נשמרה'); }}>
            <Field label="כותרת" hint="ריק = שמות המארחים ושם האירוע.">
              <input className="field" disabled={!canEdit} maxLength={70} placeholder={autoTitle} value={share.title} onChange={(e) => setShare({ ...share, title: e.target.value })} /></Field>
            <Field label="תיאור" hint="ריק = הכותרת הראשית, היום, התאריך והשעה.">
              <textarea className="field" rows={2} disabled={!canEdit} maxLength={160} placeholder={autoDesc} value={share.description} onChange={(e) => setShare({ ...share, description: e.target.value })} /></Field>
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn" disabled={!canEdit || busy === 'share' || (share.title.trim() === design.share.title && share.description.trim() === design.share.description)}>{busy === 'share' ? 'שומרים…' : 'שמירה'}</button>
              {(share.title || share.description) && <button type="button" className="btn btn-ghost" onClick={() => setShare({ title: '', description: '' })}>חזרה לטקסט האוטומטי</button>}
            </div>
            <p className="text-xs text-muted">WhatsApp שומר אצלו את הכרטיס של קישור שכבר נשלח. שינוי כאן יופיע בהודעות חדשות, ולפעמים רק אחרי כמה שעות.</p>
          </form>
        </div>
      </section>

      <section className="card mt-4 p-5" data-testid="link-guests">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-medium">קישורים אישיים</h2>
            <p className="mt-1 text-sm text-muted">כל משפחה מקבלת קישור משלה, וכך התשובה נרשמת על שמה בלי שתקליד פרטים. אפשר להחליף את הקוד במילה קצרה, למשל <span dir="ltr">cohen</span>.</p>
          </div>
          {guests.length > 6 && <input className="field sm:w-56" type="search" placeholder="חיפוש משפחה" aria-label="חיפוש משפחה" value={q} onChange={(e) => setQ(e.target.value)} />}
        </div>
        {!guests.length && <p className="mt-4 text-sm text-muted">עדיין אין מוזמנים. אחרי שמוסיפים משפחות במסך "מוזמנים", הקישורים שלהן יופיעו כאן.</p>}
        <ul className="mt-3 divide-y divide-line">
          {shown.map((g) => {
            const url = inviteUrl(origin, event.slug, g);
            const editing = edit?.id === g.id;
            return (
              <li key={g.id} className="link-row" data-testid="link-row">
                <div className="min-w-0">
                  <b className="block truncate">{g.family_name}</b>
                  {editing
                    ? <form className="link-edit mt-1" dir="ltr" onSubmit={(e) => { e.preventDefault(); void saveCode(g, edit.code); }}>
                        <span>/{event.slug}/</span>
                        <input className="field" autoFocus aria-label={`קוד הקישור של ${g.family_name}`} maxLength={24} autoCapitalize="none" autoCorrect="off" spellCheck={false} value={edit.code} onChange={(e) => setEdit({ id: g.id, code: e.target.value.replace(/[^A-Za-z0-9-]/g, '') })} />
                      </form>
                    : <span className="block truncate text-sm text-muted" dir="ltr">{url.replace(/^https?:\/\//, '')}</span>}
                  {g.invited_at && <span className="text-xs text-muted">נשלחה הזמנה</span>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {editing ? <>
                    <button type="button" className="btn btn-sm" disabled={busy === g.id || !LINK_CODE.test(edit.code) || edit.code === g.link_code} onClick={() => saveCode(g, edit.code)}>שמירה</button>
                    <button type="button" className="btn btn-ghost btn-sm" title="קוד אקראי שאי אפשר לנחש" onClick={() => setEdit({ id: g.id, code: randomCode() })}>קוד אקראי</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit(null)}>ביטול</button>
                  </> : <>
                    <button type="button" className="btn btn-sm" onClick={() => copy(url)}>העתקה</button>
                    {canEdit && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit({ id: g.id, code: g.link_code ?? '' })}>עריכה</button>}
                  </>}
                </div>
              </li>
            );
          })}
        </ul>
        {guests.length > 0 && <p className="mt-3 text-xs text-muted">מי שמחזיק בקישור אישי יכול לענות בשם המשפחה. קוד קצר וקל לניחוש, כמו שם משפחה נפוץ, פחות בטוח מקוד אקראי.</p>}
      </section>
    </>
  );
}

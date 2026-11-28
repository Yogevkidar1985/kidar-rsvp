'use client';
import { shortLink } from '@/lib/templates';
import { resolveDesign } from '@/lib/defaults';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useDuplicates } from '@/components/admin/Duplicates';
import { useEvent } from '@/components/admin/EventContext';
import { PageHead } from '@/components/admin/Shell';
import { Icon } from '@/components/admin/icons';
import { StatusPill, fmtDateTime, useToast } from '@/components/admin/ui';
import { computeStats } from '@/lib/stats';
import { eventStart, fmtWhen } from '@/lib/when';
import type { ResponseRow } from '@/lib/types';

const SOURCE: Record<string, string> = { public: 'דרך ההזמנה', admin: 'עודכן במערכת', system: 'מערכת' };
const TONE = { ok: 'var(--color-ok)', warn: 'var(--color-warn)', no: 'var(--color-no)', idle: '#cfd6e1', ink: 'var(--color-ink)' };

function Stat({ label, value, sub, tone, href }: { label: string; value: React.ReactNode; sub?: string; tone?: string; href?: string }) {
  const body = (
    <>
      <span className="stat-label">{label}</span>
      <span className="stat-value" style={tone ? { color: tone } : undefined}>{value}</span>
      {sub && <span className="text-xs text-muted">{sub}</span>}
    </>
  );
  return href ? <Link href={href} className="card stat transition-colors hover:border-[#cdd5e1]">{body}</Link> : <div className="card stat">{body}</div>;
}

export default function Overview() {
  const { event, guests, tables } = useEvent();
  const toast = useToast();
  const s = useMemo(() => computeStats(guests), [guests]);
  const [log, setLog] = useState<ResponseRow[]>([]);
  const [wa, setWa] = useState<{ failed: number; next: string | null } | null>(null);
  const [green, setGreen] = useState<boolean | null>(null);
  useEffect(() => { fetch(`/api/admin/integrations?event=${event.id}`).then((r) => r.json()).then((j) => setGreen(!!j.greenApiConfigured)).catch(() => setGreen(null)); }, [event.id]);
  const [visits, setVisits] = useState<{ guest_id: string | null; kind: string; visitor: string | null }[] | null>(null);
  const stamp = guests.reduce((m, g) => (g.updated_at > m ? g.updated_at : m), '');
  const base = `/admin/events/${event.id}`;
  useEffect(() => {
    const db = supabaseBrowser();
    db.from('rsvp_responses').select('id,guest_id,status,adults,children,babies,arrived,source,created_at')
      .eq('event_id', event.id).order('created_at', { ascending: false }).limit(12)
      .then(({ data }: { data: ResponseRow[] | null }) => setLog(data ?? []));
    // WhatsApp figures exist once the messaging tables were added; until then this part stays hidden
    Promise.all([
      db.from('messages').select('id', { count: 'exact', head: true }).eq('event_id', event.id).eq('status', 'failed'),
      db.from('campaigns').select('scheduled_at').eq('event_id', event.id).eq('kind', 'reminder').eq('status', 'scheduled').order('scheduled_at').limit(1),
    ]).then(([f, c]) => setWa(f.error || c.error ? null : { failed: f.count ?? 0, next: (c.data as { scheduled_at: string }[] | null)?.[0]?.scheduled_at ?? null }));
    // who opened the invitation: present once the analytics table was added
    db.from('invitation_events').select('guest_id,kind,visitor').eq('event_id', event.id).limit(20000)
      .then(({ data, error }: { data: typeof visits; error: unknown }) => setVisits(error ? null : data ?? []));
  }, [event.id, stamp]);
  // re-read every half minute so openings show up without a refresh
  const [beat, setBeat] = useState(0);
  useEffect(() => { const id = setInterval(() => { if (!document.hidden) setBeat((n) => n + 1); }, 30000); return () => clearInterval(id); }, []);
  useEffect(() => {
    if (!beat) return;
    supabaseBrowser().from('invitation_events').select('guest_id,kind,visitor').eq('event_id', event.id).limit(20000)
      .then(({ data, error }: { data: typeof visits; error: unknown }) => { if (!error) setVisits(data ?? []); });
  }, [beat, event.id]);
  const funnel = useMemo(() => {
    if (!visits) return null;
    const opened = new Set(visits.filter((v) => v.kind === 'visit' && v.guest_id).map((v) => v.guest_id));
    const started = new Set(visits.filter((v) => v.kind === 'rsvp_start' && v.guest_id).map((v) => v.guest_id));
    const anon = new Set(visits.filter((v) => v.kind === 'visit' && !v.guest_id).map((v) => v.visitor));
    const answered = guests.filter((g) => g.status !== 'pending');
    // a family that answered has certainly opened the invitation, even from a browser that blocked the count
    const openedAll = new Set([...opened, ...answered.filter((g) => g.source === 'admin' ? opened.has(g.id) : true).map((g) => g.id)]);
    return {
      views: visits.filter((v) => v.kind === 'visit').length, anon: anon.size, started: started.size,
      steps: [
        { label: 'משפחות ברשימה', value: guests.length },
        { label: 'קיבלו הזמנה ב-WhatsApp', value: guests.filter((g) => g.invited_at).length },
        { label: 'פתחו את ההזמנה', value: [...openedAll].filter((id) => guests.some((g) => g.id === id)).length },
        { label: 'השיבו', value: answered.length },
        { label: 'אישרו הגעה', value: guests.filter((g) => g.status === 'attending').length },
      ],
    };
  }, [visits, guests]);
  const names = useMemo(() => new Map(guests.map((g) => [g.id, g.family_name])), [guests]);
  // an answer is "new" when it is the family's first one: given within a minute of the family joining the list
  const firstOf = useMemo(() => { const born = new Map(guests.map((g) => [g.id, new Date(g.created_at).getTime()])); const m = new Map<string, string | number>(); for (const r of log) if (Math.abs(new Date(r.created_at).getTime() - (born.get(r.guest_id) ?? 0)) < 60000) m.set(r.guest_id, r.id); return m; }, [guests, log]);
  const url = shortLink(resolveDesign(event.design).shortUrl) || (typeof window !== 'undefined' ? `${window.location.origin}/${event.slug}` : `/${event.slug}`);
  const seatsTotal = tables.reduce((n, t) => n + t.capacity, 0);
  const invitedSent = guests.filter((g) => g.invited_at).length;
  const start = eventStart(event);
  const parts = [
    { label: 'מגיעים', value: s.attendingFamilies, color: TONE.ok }, { label: 'עדיין לא בטוחים', value: s.maybeFamilies, color: TONE.warn },
    { label: 'לא מגיעים', value: s.declinedFamilies, color: TONE.no }, { label: 'טרם השיבו', value: s.pendingFamilies, color: TONE.idle },
  ];
  const maxSeats = Math.max(s.confirmedSeats, seatsTotal, 1);
  const maybes = guests.filter((g) => g.status === 'maybe');
  const maybeSeats = maybes.reduce((n, g) => n + (g.adults + g.children || g.allocated_seats || 1), 0);
  const tiles = [
    { label: 'עדיין לא בטוחים', families: s.maybeFamilies, sub: s.maybeFamilies ? `עד ${maybeSeats === 1 ? 'אדם אחד' : `${maybeSeats} אנשים`}` : 'אין כרגע', color: TONE.warn },
    { label: 'לא מגיעים', families: s.declinedFamilies, sub: s.declinedFamilies ? `${s.declinedPeople} מוזמנים` : 'אין כרגע', color: TONE.no },
    { label: 'טרם השיבו', families: s.pendingFamilies, sub: s.pendingFamilies ? `${s.pendingPeople} מוזמנים` : s.families ? 'כולם השיבו' : 'הרשימה ריקה', color: '#8a94a6' },
  ];
  // the clock is read after the page is on screen, so the server's page and the browser's agree
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); }, [stamp]);
  const days = now && start ? Math.ceil((new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000) : null;
  const prefs = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of guests) if (g.status === 'attending' || g.status === 'maybe') for (const x of (g.preferences ?? '').split(',').map((t) => t.trim()).filter(Boolean)) m.set(x, (m.get(x) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [guests]);
  const when = [start ? fmtWhen(start) : '', event.venue_name].filter(Boolean).join(' · ');
  const stampText = now ? now.toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  const one = (n: number, single: string, many: string) => (n === 1 ? single : `${n} ${many}`);
  const report = [
    `*${event.name}*`,
    'דוח אישורי הגעה',
    when,
    stampText ? `מעודכן ל-${stampText}` : '',
    '',
    `*מגיעים: ${one(s.attendingPeople, 'אדם אחד', 'אנשים')}* (${one(s.attendingFamilies, 'משפחה אחת', 'משפחות')})`,
    `מבוגרים ${s.adults} · ילדים ${s.children} · תינוקות ${s.babies}`,
    `כיסאות נדרשים: ${s.confirmedSeats}`,
    '',
    `עדיין לא בטוחים: ${one(s.maybeFamilies, 'משפחה אחת', 'משפחות')}${s.maybeFamilies ? ` (עד ${one(maybeSeats, 'אדם אחד', 'אנשים')})` : ''}`,
    `לא מגיעים: ${one(s.declinedFamilies, 'משפחה אחת', 'משפחות')}`,
    `טרם השיבו: ${one(s.pendingFamilies, 'משפחה אחת', 'משפחות')}${s.pendingFamilies ? ` (${s.pendingPeople} מוזמנים)` : ''}`,
    ...(prefs.length ? ['', 'בקשות מיוחדות:', ...prefs.map(([k, n]) => `${k}: ${n}`)] : []),
  ].filter((l, i) => l || i === 4 || i === 8 || i > 11).join('\n').replace(/\n{3,}/g, '\n\n');
  const dups = useDuplicates(event.id, guests);
  const ready: { ok: boolean; label: string; fix: string; href?: string }[] = [
    { ok: event.published, label: 'ההזמנה מפורסמת', fix: 'אורחים לא יכולים לפתוח אותה', href: `${base}/editor` },
    { ok: !!(event.venue_name || event.address), label: 'מקום האירוע וכתובת', fix: 'אורחים לא יודעים לאן להגיע', href: `${base}/editor?tab=מקום` },
    { ok: !!start, label: 'תאריך ושעה', fix: 'חסרים תאריך או שעה', href: `${base}/editor?tab=מועד` },
    { ok: !!event.hero_url, label: 'תמונה משלכם', fix: 'מוצגת תמונת ברירת המחדל', href: `${base}/editor?tab=תמונות` },
    { ok: green === true, label: 'התראות WhatsApp למארחים', fix: green === null ? 'לא הצלחנו לבדוק' : 'לא מחובר: לא תקבלו הודעה כשאורח משיב', href: `${base}/connections` },
    { ok: !!wa, label: 'הזמנות ותזכורות ב-WhatsApp', fix: 'נדרש עדכון חד-פעמי למסד הנתונים', href: `${base}/whatsapp` },
    { ok: guests.length > 0, label: 'רשימת מוזמנים', fix: 'הרשימה ריקה', href: `${base}/guests` },
    ...(guests.length > 1 ? [{ ok: dups.groups.length === 0, label: 'אין כפילויות ברשימה', fix: `${dups.groups.length} קבוצות של רשומות דומות מחכות לבדיקה`, href: `${base}/guests?view=dups` }] : []),
  ];
  const missing = ready.filter((r) => !r.ok).length;
  // the one thing most worth doing now
  const next = !event.published ? { text: 'ההזמנה עדיין טיוטה. אורחים לא יכולים לפתוח אותה עד הפרסום.', cta: 'לעיצוב ולפרסום', href: `${base}/editor` }
    : !guests.length ? { text: 'עדיין אין מוזמנים ברשימה.', cta: 'הוספת מוזמנים', href: `${base}/guests` }
    : wa && invitedSent < guests.length ? { text: `${guests.length - invitedSent} משפחות עדיין לא קיבלו הזמנה ב-WhatsApp.`, cta: 'שליחת הזמנות', href: `${base}/whatsapp` }
    : wa && !wa.next && s.attendingFamilies > 0 && start && start.getTime() > Date.now() ? { text: 'לא תוזמנה תזכורת למי שאישרו הגעה.', cta: 'תזמון תזכורת', href: `${base}/reminders` }
    : null;

  const actions = (
    <>
      <button className="btn btn-ghost" onClick={() => navigator.clipboard.writeText(url).then(() => toast('הקישור הועתק'), () => toast('לא הצלחנו להעתיק', true))}><Icon name="copy" size={16} />העתקת הקישור</button>
      {event.published && <a className="btn" href={`/e/${event.slug}`} target="_blank" rel="noopener noreferrer"><Icon name="eye" size={16} />פתיחת ההזמנה</a>}
    </>
  );
  const fam = (n: number) => (n === 1 ? 'משפחה אחת' : `${n} משפחות`);
  const ppl = (n: number) => (n === 1 ? 'אדם אחד' : `${n} אנשים`);
  const people = (r: { adults: number; children: number; babies: number }) => [r.adults && `${r.adults} מבוגרים`, r.children && `${r.children} ילדים`, r.babies && `${r.babies} תינוקות`].filter(Boolean).join(' · ');

  return (
    <>
      <PageHead title="סקירה" sub={start ? `האירוע ב-${fmtWhen(start)}` : 'הנתונים מתעדכנים מיד כשאורח שולח תשובה'}>
        <div className="hidden gap-2 sm:flex">{actions}</div>
      </PageHead>
      <div className="ov-actions sm:hidden">{actions}</div>

      <div className="ov">
      <section className="ov-hero" data-testid="kpis">
        <div className="ov-hero__main">
          <span className="ov-hero__label">מגיעים לאירוע</span>
          <div className="ov-hero__num"><b>{s.attendingPeople}</b><span>{s.attendingPeople === 1 ? 'אדם' : 'אנשים'}</span></div>
          <p className="ov-hero__sub">{s.families ? `${s.attendingFamilies === 1 ? 'משפחה אחת אישרה' : `${s.attendingFamilies} משפחות אישרו`} · מתוך ${s.invitedTotal} מוזמנים` : 'המספרים יתמלאו כשתוסיפו מוזמנים והם ישיבו'}</p>
          <ul className="ov-split" aria-label="פירוט המגיעים">
            <li><b>{s.adults}</b> <span>מבוגרים</span></li>
            <li><b>{s.children}</b> <span>ילדים</span></li>
            <li><b>{s.babies}</b> <span>תינוקות</span></li>
            <li className="is-key"><b>{s.confirmedSeats}</b> <span>כיסאות</span></li>
          </ul>
        </div>
        <div className="ov-hero__side">
          <div className="ov-ring" role="img" aria-label={`${s.responseRate}% מהמשפחות השיבו`}>
            <svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="50" />{s.responseRate > 0 && <circle cx="60" cy="60" r="50" pathLength="100" strokeDasharray={`${s.responseRate} 100`} />}</svg>
            <div><b>{s.responseRate}%</b><span>השיבו</span></div>
          </div>
          <p className="ov-hero__when">{s.families ? `${s.families - s.pendingFamilies} מתוך ${s.families} משפחות` : 'עוד אין מוזמנים ברשימה'}{days !== null && <><br /><b>{days > 1 ? `עוד ${days} ימים לאירוע` : days === 1 ? 'האירוע מחר' : days === 0 ? 'האירוע היום' : 'האירוע עבר'}</b></>}</p>
        </div>
        <div className="ov-tiles">
          {tiles.map((t) => (
            <Link key={t.label} href={`${base}/guests`} className="ov-tile" style={{ '--tone': t.color } as React.CSSProperties}>
              <span className="ov-tile__label"><i aria-hidden="true" />{t.label}</span>
              <span className="ov-tile__num"><b>{t.families}</b> <span>{t.families === 1 ? 'משפחה' : 'משפחות'}</span></span>
              <span className="ov-tile__sub">{t.sub}</span>
            </Link>
          ))}
        </div>
      </section>

      <div className="ov-grid">
        <section className="card ov-card ov-wide">
          <h2 className="ov-h">תשובות לפי משפחות</h2>
          <div className="ov-bar" role="img" aria-label={parts.map((p) => `${p.label}: ${p.value}`).join(', ')}>
            {parts.filter((p) => p.value > 0).map((p) => <i key={p.label} style={{ width: `${(p.value / Math.max(s.families, 1)) * 100}%`, background: p.color }} />)}
          </div>
          <ul className="ov-legend">
            {parts.map((p) => <li key={p.label}><span><i style={{ background: p.color }} />{p.label}</span><b>{p.value}</b></li>)}
          </ul>

          <h3 className="ov-h ov-h--sub" data-testid="seats-card">מקומות ישיבה</h3>
          <dl className="ov-rows">
            <div><dt>כיסאות נדרשים<small>מבוגרים וילדים שאישרו{maybeSeats ? `, ועוד עד ${maybeSeats} מהלא-בטוחים` : ''}</small></dt><dd>{s.confirmedSeats}</dd></div>
            <div><dt>מקומות בשולחנות<small>{tables.length ? fam(tables.length).replace('משפחות', 'שולחנות').replace('משפחה אחת', 'שולחן אחד') : <Link className="font-medium text-ink underline" href={`${base}/tables`}>עוד לא הוגדרו שולחנות</Link>}</small></dt><dd>{seatsTotal}</dd></div>
            {seatsTotal > 0 && <div className={(seatsTotal - s.confirmedSeats) < 0 ? 'is-short' : 'is-free'}><dt>{(seatsTotal - s.confirmedSeats) < 0 ? 'מקומות חסרים' : 'מקומות פנויים'}<small>{Math.min(100, Math.round((s.confirmedSeats / seatsTotal) * 100))}% מהמקומות תפוסים</small></dt><dd>{Math.abs((seatsTotal - s.confirmedSeats))}</dd></div>}
          </dl>
          {seatsTotal > 0 && <div className="ov-bar ov-bar--thin" aria-hidden="true">
            <i style={{ width: `${(s.confirmedSeats / maxSeats) * 100}%`, background: TONE.ok }} /><i style={{ width: `${(Math.min(maybeSeats, Math.max(maxSeats - s.confirmedSeats, 0)) / maxSeats) * 100}%`, background: TONE.warn, opacity: 0.45 }} />
          </div>}
        </section>

        <section className="card ov-card" data-testid="owner-report">
          <header>
            <h2 className="ov-h">דוח לבעל האירוע</h2>
            <p className="ov-sub">המספרים לפי אישורי ההגעה, מוכנים לשליחה למקום או לקייטרינג.</p>
            <p className="ov-meta">{when}{stampText && <><br />מעודכן ל-<span dir="ltr">{stampText}</span></>}</p>
          </header>
          <dl className="ov-rows">
            <div className="is-key"><dt>מגיעים<small>{fam(s.attendingFamilies)}</small></dt><dd>{s.attendingPeople}<small>{s.attendingPeople === 1 ? 'אדם' : 'אנשים'}</small></dd></div>
            <div className="ov-trio"><span><b>{s.adults}</b>מבוגרים</span><span><b>{s.children}</b>ילדים</span><span><b>{s.babies}</b>תינוקות</span></div>
            <div><dt>כיסאות נדרשים</dt><dd>{s.confirmedSeats}</dd></div>
            <div><dt>עדיין לא בטוחים{s.maybeFamilies > 0 && <small>עד {ppl(maybeSeats)} נוספים</small>}</dt><dd>{s.maybeFamilies}<small>{s.maybeFamilies === 1 ? 'משפחה' : 'משפחות'}</small></dd></div>
            <div><dt>לא מגיעים</dt><dd>{s.declinedFamilies}<small>{s.declinedFamilies === 1 ? 'משפחה' : 'משפחות'}</small></dd></div>
            <div><dt>טרם השיבו{s.pendingFamilies > 0 && <small>{s.pendingPeople} מוזמנים</small>}</dt><dd>{s.pendingFamilies}<small>{s.pendingFamilies === 1 ? 'משפחה' : 'משפחות'}</small></dd></div>
          </dl>
          {prefs.length > 0 && <div><span className="ov-meta">בקשות מיוחדות</span><ul className="ov-chips">{prefs.map(([k, n]) => <li key={k}>{k}<b>{n}</b></li>)}</ul></div>}
          <pre className="sr-only" aria-hidden="true">{report}</pre>
          <div className="ov-btns">
            <button type="button" className="btn" data-testid="report-copy" onClick={() => navigator.clipboard.writeText(report).then(() => toast('הדוח הועתק'), () => toast('לא הצלחנו להעתיק', true))}><Icon name="copy" size={16} />העתקת הדוח</button>
            <a className="btn btn-ghost" data-testid="report-wa" href={`https://wa.me/?text=${encodeURIComponent(report)}`} target="_blank" rel="noopener noreferrer"><Icon name="message" size={16} />WhatsApp</a>
          </div>
          <p className="ov-note">הכפתור פותח את WhatsApp שלכם עם הדוח, ואתם בוחרים למי לשלוח. שום דבר לא נשלח לבד.</p>
        </section>
      </div>

      {next && missing === 0 && (
        <div className="card ov-card ov-next">
          <p className="text-sm"><b className="font-semibold">הצעד הבא: </b>{next.text}</p>
          <Link className="btn btn-sm" href={next.href}>{next.cta}</Link>
        </div>
      )}

      {missing > 0 && (
        <section className="card ov-card" data-testid="readiness">
          <h2 className="ov-h">מוכנות האירוע <span className="text-sm font-normal text-muted">· {ready.length - missing} מתוך {ready.length}</span></h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {ready.filter((r) => !r.ok).map((r) => (
              <li key={r.label} className="ov-todo">
                <span className="grid size-6 flex-none place-items-center rounded-full bg-[#fbeaea] text-no"><Icon name="close" size={14} /></span>
                <span className="min-w-0 flex-1"><b className="block font-semibold">{r.label}</b><span className="block text-[13px] text-muted">{r.fix}</span></span>
                {r.href && <Link className="btn btn-ghost btn-sm flex-none" href={r.href}>לתיקון</Link>}
              </li>
            ))}
          </ul>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">{ready.filter((r) => r.ok).map((r) => <span key={r.label} className="inline-flex items-center gap-1"><span className="text-ok"><Icon name="check" size={13} /></span>{r.label}</span>)}</p>
        </section>
      )}

      <div className="ov-grid">
        <section className="card ov-card">
          <h2 className="ov-h">הזמנות ותזכורות</h2>
          {wa ? (
            <>
              <Row label="קיבלו הזמנה ב-WhatsApp" value={`${invitedSent} מתוך ${guests.length}`} />
              <Row label="הודעות שנכשלו" value={wa.failed} tone={wa.failed ? TONE.no : undefined} />
              <Row label="התזכורת הבאה" value={wa.next ? fmtWhen(wa.next) : 'לא תוזמנה'} />
              <div className="flex flex-wrap gap-2 pt-1"><Link className="btn btn-ghost btn-sm" href={`${base}/whatsapp`}>הזמנות</Link><Link className="btn btn-ghost btn-sm" href={`${base}/reminders`}>תזכורות</Link></div>
            </>
          ) : <p className="text-sm text-muted">שליחת הזמנות ותזכורות ב-WhatsApp תהיה זמינה אחרי עדכון מסד הנתונים.</p>}
          <div className="border-t border-line pt-4"><Row label="הגיעו בפועל" value={`${s.arrivedPeople} אנשים · ${s.arrivedFamilies} משפחות`} /></div>
        </section>
      {funnel && (
        <section className="card ov-card ov-wide lg:order-first" data-testid="funnel">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="ov-h">מסלול ההזמנה</h2>
            <span className="text-xs text-muted">{funnel.views} צפיות בסך הכול{funnel.anon ? ` · ${funnel.anon} מבקרים דרך הקישור הכללי` : ''}</span>
          </div>
          <ol className="grid gap-3">
            {funnel.steps.map((st, i) => {
              const top = Math.max(funnel.steps[0].value, 1);
              return (
                <li key={st.label} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 text-sm sm:grid-cols-[minmax(0,11rem)_1fr_auto]">
                  <span className="truncate text-muted">{st.label}</span>
                  <span className="order-3 col-span-2 h-5 overflow-hidden rounded-md bg-paper sm:order-none sm:col-span-1 sm:h-6"><span className="block h-full rounded-md" style={{ width: `${Math.max((st.value / top) * 100, st.value ? 3 : 0)}%`, background: i === funnel.steps.length - 1 ? TONE.ok : TONE.ink, opacity: i === funnel.steps.length - 1 ? 1 : 0.35 + i * 0.15 }} /></span>
                  <span className="inline-flex items-baseline justify-end gap-1.5 tabular-nums sm:w-20"><b className="font-semibold">{st.value}</b>{i > 0 && <span className="text-xs text-muted">{Math.round((st.value / top) * 100)}%</span>}</span>
                </li>
              );
            })}
          </ol>
          <details className="text-xs text-muted"><summary className="flex min-h-10 cursor-pointer items-center font-medium text-ink">איך המספרים נספרים?</summary><p className="mt-1">האחוזים הם מתוך כל המשפחות ברשימה. הספירה היא של משפחות, לא של אנשים: {s.attendingFamilies} משפחות שאישרו הן {s.attendingPeople} משתתפים. "פתחו" נספר רק כשההזמנה נטענה בדפדפן של אדם, לא בתצוגת קישור של WhatsApp.</p></details>
        </section>
      )}

      </div>

      <section className="card ov-card">
        <h2 className="ov-h">תשובות אחרונות</h2>
        {!log.length ? <p className="ov-sub">עדיין לא התקבלו תשובות. כל אישור ושינוי יופיעו כאן.</p> : (
          <ul className="divide-y divide-line text-sm">
            {log.map((r) => (
              <li key={r.id} className="ov-log">
                <b>{names.get(r.guest_id) ?? 'משפחה שנמחקה'}</b>
                <span className="ov-log__pills"><StatusPill status={r.status} />{r.arrived && <span className="pill pill-attending">הגיעו</span>}</span>
                <span className="ov-log__who">{r.status !== 'declined' && people(r)}</span>
                <span className="ov-log__when"><span className={`ov-log__tag ${firstOf.get(r.guest_id) === r.id ? 'is-new' : 'is-upd'}`}>{firstOf.get(r.guest_id) === r.id ? 'אישור חדש' : 'עדכון'}</span> {SOURCE[r.source] ?? r.source} · <span dir="ltr">{fmtDateTime(r.created_at)}</span></span>
              </li>
            ))}
          </ul>
        )}
      </section>
      </div>
    </>
  );
}

function Row({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return <div className="flex items-baseline justify-between gap-3 text-sm"><span className="text-muted">{label}</span><b className="font-semibold tabular-nums" style={tone ? { color: tone } : undefined}>{value}</b></div>;
}
function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between"><span className="text-muted">{label}</span><b className="font-semibold tabular-nums">{value}</b></div>
      <div className="h-2 rounded-full bg-paper"><div className="h-full rounded-full" style={{ width: `${(value / max) * 100}%`, background: color }} /></div>
    </div>
  );
}

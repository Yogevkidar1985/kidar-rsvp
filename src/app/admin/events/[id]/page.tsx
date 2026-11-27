'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase/client';
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
  const url = typeof window !== 'undefined' ? `${window.location.origin}/e/${event.slug}` : `/e/${event.slug}`;
  const seatsTotal = tables.reduce((n, t) => n + t.capacity, 0);
  const invitedSent = guests.filter((g) => g.invited_at).length;
  const start = eventStart(event);
  const parts = [
    { label: 'מגיעים', value: s.attendingFamilies, color: TONE.ok }, { label: 'עדיין לא בטוחים', value: s.maybeFamilies, color: TONE.warn },
    { label: 'לא מגיעים', value: s.declinedFamilies, color: TONE.no }, { label: 'טרם השיבו', value: s.pendingFamilies, color: TONE.idle },
  ];
  const maxSeats = Math.max(s.allocatedSeats, s.confirmedSeats, seatsTotal, 1);
  const ready: { ok: boolean; label: string; fix: string; href?: string }[] = [
    { ok: event.published, label: 'ההזמנה מפורסמת', fix: 'אורחים לא יכולים לפתוח אותה', href: `${base}/editor` },
    { ok: !!(event.venue_name || event.address), label: 'מקום האירוע וכתובת', fix: 'אורחים לא יודעים לאן להגיע', href: `${base}/editor` },
    { ok: !!start, label: 'תאריך ושעה', fix: 'חסרים תאריך או שעה', href: `${base}/editor` },
    { ok: !!event.hero_url, label: 'תמונה משלכם', fix: 'מוצגת תמונת ברירת המחדל', href: `${base}/editor` },
    { ok: green === true, label: 'התראות WhatsApp למארחים', fix: green === null ? 'לא הצלחנו לבדוק' : 'לא מחובר: לא תקבלו הודעה כשאורח משיב', href: `${base}/connections` },
    { ok: !!wa, label: 'הזמנות ותזכורות ב-WhatsApp', fix: 'נדרש עדכון חד-פעמי למסד הנתונים', href: `${base}/whatsapp` },
    { ok: guests.length > 0, label: 'רשימת מוזמנים', fix: 'הרשימה ריקה', href: `${base}/guests` },
  ];
  const missing = ready.filter((r) => !r.ok).length;
  // the one thing most worth doing now
  const next = !event.published ? { text: 'ההזמנה עדיין טיוטה. אורחים לא יכולים לפתוח אותה עד הפרסום.', cta: 'לעיצוב ולפרסום', href: `${base}/editor` }
    : !guests.length ? { text: 'עדיין אין מוזמנים ברשימה.', cta: 'הוספת מוזמנים', href: `${base}/guests` }
    : wa && invitedSent < guests.length ? { text: `${guests.length - invitedSent} משפחות עדיין לא קיבלו הזמנה ב-WhatsApp.`, cta: 'שליחת הזמנות', href: `${base}/whatsapp` }
    : wa && !wa.next && s.attendingFamilies > 0 && start && start.getTime() > Date.now() ? { text: 'לא תוזמנה תזכורת למי שאישרו הגעה.', cta: 'תזמון תזכורת', href: `${base}/reminders` }
    : null;

  return (
    <>
      <PageHead title="סקירה" sub={start ? `האירוע ב-${fmtWhen(start)}` : 'הנתונים מתעדכנים מיד כשאורח שולח תשובה'}>
        <button className="btn btn-ghost" onClick={() => navigator.clipboard.writeText(url).then(() => toast('הקישור הועתק'), () => toast('לא הצלחנו להעתיק', true))}><Icon name="copy" size={16} />העתקת הקישור</button>
        {event.published && <a className="btn" href={`/e/${event.slug}`} target="_blank" rel="noopener noreferrer"><Icon name="eye" size={16} />פתיחת ההזמנה</a>}
      </PageHead>

      {next && missing === 0 && (
        <div className="card mb-4 flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className="text-sm"><b className="font-semibold">הצעד הבא: </b>{next.text}</p>
          <Link className="btn btn-sm" href={next.href}>{next.cta}</Link>
        </div>
      )}

      {missing > 0 && (
        <section className="card mb-4 p-4" data-testid="readiness">
          <h2 className="text-[17px] font-semibold">מוכנות האירוע <span className="text-sm font-normal text-muted">· {ready.length - missing} מתוך {ready.length}</span></h2>
          <ul className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {ready.map((r) => (
              <li key={r.label} className="flex items-start gap-2 text-sm">
                <span className={`mt-0.5 grid size-5 flex-none place-items-center rounded-full ${r.ok ? 'bg-[#e7f4ee] text-ok' : 'bg-[#fbeaea] text-no'}`}><Icon name={r.ok ? 'check' : 'close'} size={13} /></span>
                <span className="min-w-0"><b className="font-medium">{r.label}</b>{!r.ok && <span className="block text-muted">{r.fix}{r.href && <> · <Link className="font-medium text-ink underline" href={r.href}>לתיקון</Link></>}</span>}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="kpis">
        <Stat label="סך המוזמנים" value={s.invitedTotal} sub={`${s.families} משפחות`} href={`${base}/guests`} />
        <Stat label="אישרו הגעה" value={s.attendingPeople} sub={`${s.attendingFamilies} משפחות · ${s.adults} מבוגרים, ${s.children} ילדים, ${s.babies} תינוקות`} tone={TONE.ok} />
        <Stat label="טרם השיבו" value={s.pendingPeople} sub={`${s.pendingFamilies} משפחות · ${s.responseRate}% השיבו`} />
        <Stat label="לא מגיעים" value={s.declinedPeople} sub={`${s.declinedFamilies} משפחות${s.maybeFamilies ? ` · ${s.maybeFamilies} עדיין לא בטוחים` : ''}`} tone={s.declinedPeople ? TONE.no : undefined} />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <section className="card p-5 lg:col-span-2">
          <h2 className="text-[17px] font-semibold">תשובות לפי משפחות</h2>
          <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-paper" role="img" aria-label={parts.map((p) => `${p.label}: ${p.value}`).join(', ')}>
            {parts.filter((p) => p.value > 0).map((p) => <div key={p.label} style={{ width: `${(p.value / Math.max(s.families, 1)) * 100}%`, background: p.color }} />)}
          </div>
          <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            {parts.map((p) => (
              <li key={p.label}>
                <div className="flex items-center gap-1.5 text-xs text-muted"><i className="size-2 rounded-full" style={{ background: p.color }} />{p.label}</div>
                <div className="mt-0.5 text-xl font-semibold tabular-nums">{p.value}</div>
              </li>
            ))}
          </ul>
          <div className="mt-5 grid gap-3 border-t border-line pt-4 text-sm">
            <Bar label="מקומות שהוקצו למשפחות" value={s.allocatedSeats} max={maxSeats} color={TONE.idle} />
            <Bar label="כיסאות שאושרו (מבוגרים וילדים)" value={s.confirmedSeats} max={maxSeats} color={TONE.ok} />
            <Bar label={`מקומות בשולחנות (${tables.length} שולחנות)`} value={seatsTotal} max={maxSeats} color={TONE.ink} />
          </div>
        </section>

        <section className="card grid content-start gap-4 p-5">
          <h2 className="text-[17px] font-semibold">הזמנות ותזכורות</h2>
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
      </div>

      {funnel && (
        <section className="card mt-3 p-5" data-testid="funnel">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[17px] font-semibold">מסלול ההזמנה</h2>
            <span className="text-xs text-muted">{funnel.views} צפיות בסך הכול{funnel.anon ? ` · ${funnel.anon} מבקרים דרך הקישור הכללי` : ''}</span>
          </div>
          <ol className="mt-4 grid gap-2.5">
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
          <p className="mt-3 text-xs text-muted">האחוזים הם מתוך כל המשפחות ברשימה. הספירה היא של משפחות, לא של אנשים: {s.attendingFamilies} משפחות שאישרו הן {s.attendingPeople} משתתפים. "פתחו" נספר רק כשההזמנה נטענה בדפדפן של אדם, לא בתצוגת קישור של WhatsApp.</p>
        </section>
      )}

      <section className="card mt-3 p-5">
        <h2 className="text-[17px] font-semibold">תשובות אחרונות</h2>
        {!log.length ? <p className="mt-2 text-sm text-muted">עדיין לא התקבלו תשובות. כל אישור ושינוי יופיעו כאן.</p> : (
          <ul className="mt-2 divide-y divide-line text-sm">
            {log.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <b className="min-w-28 font-semibold">{names.get(r.guest_id) ?? 'משפחה שנמחקה'}</b>
                <StatusPill status={r.status} />
                {r.status !== 'declined' && <span className="text-muted">{r.adults} מבוגרים, {r.children} ילדים, {r.babies} תינוקות</span>}
                {r.arrived && <span className="pill pill-attending">הגיעו</span>}
                <span className="ms-auto text-xs text-muted">{SOURCE[r.source] ?? r.source} · <span dir="ltr">{fmtDateTime(r.created_at)}</span></span>
              </li>
            ))}
          </ul>
        )}
      </section>
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

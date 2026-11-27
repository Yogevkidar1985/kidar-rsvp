'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useEvent } from '@/components/admin/EventContext';
import { PageHead } from '@/components/admin/Shell';
import { StatusPill, fmtDateTime, useToast } from '@/components/admin/ui';
import { computeStats } from '@/lib/stats';
import type { ResponseRow } from '@/lib/types';

const SOURCE: Record<string, string> = { public: 'דרך ההזמנה', admin: 'עודכן במערכת', system: 'מערכת' };

function Kpi({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: string }) {
  return (
    <div className="card p-4">
      <div className="text-sm font-semibold text-muted">{label}</div>
      <div className={`mt-1 font-display text-[34px] font-medium leading-none ${tone ?? ''}`}>{value}</div>
      {sub && <div className="mt-1.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

function Donut({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  const R = 54, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox="0 0 140 140" width="150" height="150" role="img" aria-label="התפלגות תשובות לפי משפחות">
        <circle cx="70" cy="70" r={R} fill="none" stroke="#eceff4" strokeWidth="16" />
        {total > 0 && parts.filter((p) => p.value > 0).map((p) => {
          const len = (p.value / total) * C, off = acc; acc += len;
          return <circle key={p.label} cx="70" cy="70" r={R} fill="none" stroke={p.color} strokeWidth="16"
            strokeDasharray={`${Math.max(len - 2, 0.5)} ${C}`} strokeDashoffset={-off} transform="rotate(-90 70 70)" />;
        })}
        <text x="70" y="68" textAnchor="middle" fontSize="26" fontFamily="Frank Ruhl Libre, serif" fill="#1b2440">{total}</text>
        <text x="70" y="86" textAnchor="middle" fontSize="11" fill="#66728a">משפחות</text>
      </svg>
      <ul className="grid gap-2 text-sm">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2">
            <span className="inline-block size-3 rounded-sm" style={{ background: p.color }} />
            <span className="w-24">{p.label}</span><b>{p.value}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Overview() {
  const { event, guests, tables } = useEvent();
  const toast = useToast();
  const s = useMemo(() => computeStats(guests), [guests]);
  const [log, setLog] = useState<ResponseRow[]>([]);
  const stamp = guests.reduce((m, g) => (g.updated_at > m ? g.updated_at : m), '');
  useEffect(() => {
    supabaseBrowser().from('rsvp_responses').select('id,guest_id,status,adults,children,babies,arrived,source,created_at')
      .eq('event_id', event.id).order('created_at', { ascending: false }).limit(25)
      .then(({ data }: { data: ResponseRow[] | null }) => setLog(data ?? []));
  }, [event.id, stamp]);
  const names = useMemo(() => new Map(guests.map((g) => [g.id, g.family_name])), [guests]);
  const url = typeof window !== 'undefined' ? `${window.location.origin}/e/${event.slug}` : `/e/${event.slug}`;
  const seatsTotal = tables.reduce((n, t) => n + t.capacity, 0);
  const groups = [{ label: 'מבוגרים', v: s.adults }, { label: 'ילדים', v: s.children }, { label: 'תינוקות', v: s.babies }];
  const maxG = Math.max(1, ...groups.map((g) => g.v));

  return (
    <>
      <PageHead title="סקירה" sub="הנתונים מתעדכנים מיד כשאורח שולח תשובה.">
        <button className="btn btn-ghost" onClick={() => navigator.clipboard.writeText(url).then(() => toast('הקישור הועתק'), () => toast('לא הצלחנו להעתיק', true))}>העתקת קישור ההזמנה</button>
        {event.published && <a className="btn" href={`/e/${event.slug}`} target="_blank" rel="noopener noreferrer">פתיחת ההזמנה</a>}
      </PageHead>

      {!event.published && (
        <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
          ההזמנה עדיין לא פורסמה, ולכן אורחים לא יכולים לפתוח אותה. <Link className="font-bold underline" href={`/admin/events/${event.id}/editor`}>לעיצוב ולפרסום</Link>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" data-testid="kpis">
        <Kpi label="סך המוזמנים" value={s.invitedTotal} sub={`${s.families} משפחות`} />
        <Kpi label="אישרו הגעה" value={s.attendingPeople} sub="אנשים, כולל תינוקות" tone="text-ok" />
        <Kpi label="משפחות שאישרו" value={s.attendingFamilies} />
        <Kpi label="לא מגיעים" value={s.declinedPeople} sub={`${s.declinedFamilies} משפחות`} tone="text-no" />
        <Kpi label="טרם השיבו" value={s.pendingPeople} sub={`${s.pendingFamilies} משפחות`} />
        <Kpi label="אולי מגיעים" value={s.maybeFamilies} sub={s.maybePeople ? `${s.maybePeople} אנשים` : 'משפחות'} tone="text-maybe" />
        <Kpi label="אחוז מענה" value={`${s.responseRate}%`} sub="משפחות שהשיבו" />
        <Kpi label="מבוגרים" value={s.adults} />
        <Kpi label="ילדים" value={s.children} />
        <Kpi label="תינוקות" value={s.babies} sub="ללא כיסא" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-4 font-display text-lg font-medium">תשובות לפי משפחות</h2>
          <Donut parts={[
            { label: 'מגיעים', value: s.attendingFamilies, color: '#2f7d5b' }, { label: 'אולי', value: s.maybeFamilies, color: '#d39b34' },
            { label: 'לא מגיעים', value: s.declinedFamilies, color: '#b4483f' }, { label: 'טרם השיבו', value: s.pendingFamilies, color: '#c3cad6' },
          ]} />
        </section>
        <section className="card p-5">
          <h2 className="mb-4 font-display text-lg font-medium">כיסאות לסידור השולחנות</h2>
          <div className="grid gap-3 text-sm">
            <Bar label="מקומות שהוקצו למשפחות" value={s.allocatedSeats} max={Math.max(s.allocatedSeats, s.confirmedSeats, seatsTotal, 1)} color="#c3cad6" />
            <Bar label="כיסאות שאושרו (מבוגרים וילדים)" value={s.confirmedSeats} max={Math.max(s.allocatedSeats, s.confirmedSeats, seatsTotal, 1)} color="#2f7d5b" />
            <Bar label={`מקומות בשולחנות (${tables.length} שולחנות)`} value={seatsTotal} max={Math.max(s.allocatedSeats, s.confirmedSeats, seatsTotal, 1)} color="#1b2440" />
          </div>
          <div className="mt-5 flex items-end gap-4 border-t border-line pt-4">
            {groups.map((g) => (
              <div key={g.label} className="flex-1 text-center">
                <div className="mx-auto flex h-20 w-10 items-end rounded-md bg-paper"><div className="w-full rounded-md bg-brass" style={{ height: `${(g.v / maxG) * 100}%` }} /></div>
                <div className="mt-1 font-bold">{g.v}</div><div className="text-xs text-muted">{g.label}</div>
              </div>
            ))}
            <div className="flex-[1.4] text-sm text-muted">הגיעו בפועל: <b className="text-ink">{s.arrivedPeople}</b> אנשים, {s.arrivedFamilies} משפחות</div>
          </div>
        </section>
      </div>

      <section className="card mt-4 p-5">
        <h2 className="mb-3 font-display text-lg font-medium">היסטוריית אישורים</h2>
        {!log.length ? <p className="text-sm text-muted">עדיין לא התקבלו תשובות. כל אישור, שינוי סטטוס ושינוי כמות יירשמו כאן.</p> : (
          <ul className="divide-y divide-line text-sm">
            {log.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <span className="w-24 text-muted" dir="ltr" style={{ textAlign: 'right' }}>{fmtDateTime(r.created_at)}</span>
                <b className="min-w-28">{names.get(r.guest_id) ?? 'משפחה שנמחקה'}</b>
                <StatusPill status={r.status} />
                {r.status !== 'declined' && <span>{r.adults} מבוגרים, {r.children} ילדים, {r.babies} תינוקות</span>}
                {r.arrived && <span className="pill pill-attending">הגיעו</span>}
                <span className="ms-auto text-xs text-muted">{SOURCE[r.source] ?? r.source}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between"><span>{label}</span><b>{value}</b></div>
      <div className="h-2.5 rounded-full bg-paper"><div className="h-full rounded-full" style={{ width: `${(value / max) * 100}%`, background: color }} /></div>
    </div>
  );
}

'use client';
/** Date and time controls that read the same on every phone and browser, in Hebrew and on a 24-hour clock. */
const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const pad = (n: number) => String(n).padStart(2, '0');
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** `value` is YYYY-MM-DD or null. A day that the chosen month does not have is pulled back to its last day. */
export function DateField({ value, onChange, label }: { value: string | null; onChange: (v: string | null) => void; label: string }) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  const thisYear = new Date().getFullYear();
  const y = m ? +m[1] : 0, mo = m ? +m[2] : 0, d = m ? +m[3] : 0;
  const years = [...new Set([y || thisYear, ...Array.from({ length: 7 }, (_, i) => thisYear - 1 + i)])].sort();
  const set = (ny: number, nm: number, nd: number) => {
    if (!ny && !nm && !nd) return onChange(null);
    const yy = ny || thisYear, mm = nm || 1;
    onChange(`${yy}-${pad(mm)}-${pad(Math.min(nd || 1, daysIn(yy, mm)))}`);
  };
  return (
    <div className="grid grid-cols-[1fr_1.5fr_1.2fr] gap-2" role="group" aria-label={label}>
      <select className="field" aria-label="יום" value={d || ''} onChange={(e) => set(y, mo, +e.target.value)}>
        <option value="">יום</option>
        {Array.from({ length: daysIn(y || thisYear, mo || 1) }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
      </select>
      <select className="field" aria-label="חודש" value={mo || ''} onChange={(e) => set(y, +e.target.value, d)}>
        <option value="">חודש</option>
        {MONTHS.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
      </select>
      <select className="field" aria-label="שנה" value={y || ''} onChange={(e) => set(+e.target.value, mo, d)}>
        <option value="">שנה</option>
        {years.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </div>
  );
}

/** `value` is HH:MM or null. Minutes come in steps of five; another saved minute stays selectable. */
export function TimeField({ value, onChange, label }: { value: string | null; onChange: (v: string | null) => void; label: string }) {
  const m = /^(\d{1,2}):(\d{2})/.exec(value ?? '');
  const h = m ? pad(+m[1]) : '', mi = m ? m[2] : '';
  const minutes = [...new Set([...Array.from({ length: 12 }, (_, i) => pad(i * 5)), ...(mi ? [mi] : [])])].sort();
  return (
    <div className="flex max-w-56 items-center gap-1" dir="ltr" role="group" aria-label={label}>
      <select className="field !px-1.5 text-center" aria-label={`${label}: שעה`} value={h} onChange={(e) => onChange(e.target.value ? `${e.target.value}:${mi || '00'}` : null)}>
        <option value="">--</option>
        {Array.from({ length: 24 }, (_, i) => <option key={i} value={pad(i)}>{pad(i)}</option>)}
      </select>
      <span className="text-muted">:</span>
      <select className="field !px-1.5 text-center" aria-label={`${label}: דקות`} value={mi} disabled={!h} onChange={(e) => onChange(`${h}:${e.target.value}`)}>
        {!h && <option value="">--</option>}
        {minutes.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
    </div>
  );
}

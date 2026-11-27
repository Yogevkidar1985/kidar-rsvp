import { HDate } from '@hebcal/core';

const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

function parse(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
  return d.getUTCMonth() === +m[2] - 1 ? d : null;
}
export function hebrewDate(iso: string): string {
  const d = parse(iso);
  if (!d) return '';
  const h = new HDate(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const parts = h.renderGematriya(true).split(' ');
  const year = parts.pop()!;
  const day = parts.shift()!;
  return `${day} ב${parts.join(' ')} ה${year}`;
}
export function weekdayLabel(iso: string): string {
  const d = parse(iso);
  return d ? `יום ${DAYS[d.getUTCDay()]}` : '';
}
export function dateParts(iso: string | null): { day: string; month: string; year: string; numeric: string } | null {
  const d = iso ? parse(iso) : null;
  if (!d) return null;
  const dd = String(d.getUTCDate()).padStart(2, '0'), mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return { day: String(d.getUTCDate()), month: MONTHS[d.getUTCMonth()], year: String(d.getUTCFullYear()), numeric: `${dd}.${mm}.${d.getUTCFullYear()}` };
}

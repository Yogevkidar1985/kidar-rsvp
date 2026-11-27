import type { Guest } from './types';
import { normPhone } from './phone';

/**
 * Finds guest records that may be the same family written twice. Nothing here merges or deletes: it only points,
 * and says in plain words why two records were put together, so a person can decide.
 */
export type Confidence = 'very_high' | 'high' | 'medium' | 'low';
export const CONFIDENCE_LABEL: Record<Confidence, string> = { very_high: 'כמעט ודאי', high: 'סביר מאוד', medium: 'אפשרי', low: 'חלש' };
const RANK: Record<Confidence, number> = { very_high: 3, high: 2, medium: 1, low: 0 };

export type Match = { a: string; b: string; confidence: Confidence; reasons: string[]; critical: boolean };
export type DupGroup = { ids: string[]; confidence: Confidence; reasons: string[]; critical: boolean; key: string };

const FINALS: Record<string, string> = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
/** A name as it is compared: no "family of", no punctuation, final letters folded, words in a fixed order. */
export function normName(raw: string | null | undefined): string {
  const s = (raw ?? '').normalize('NFKC').toLowerCase()
    .replace(/[֑-ׇ]/g, '')                       // Hebrew points
    .replace(/["'`׳״.,\-_/\\()]+/g, ' ')
    .replace(/[ךםןףץ]/g, (c) => FINALS[c])
    .replace(/(^|\s)(משפחת|משפ|בית|family|the|mr|mrs|ms|dr|ד ר|מר|גב)(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return s.split(' ').filter(Boolean).sort().join(' ');
}
/** The same name with the letters that come and go in Hebrew spelling removed (כהן / כוהן, רויטל / רוויטל). */
const skeleton = (n: string) => n.replace(/[וי]/g, '').replace(/(.)\1+/g, '$1');

function distance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

type Kind = 'exact' | 'similar' | 'partial' | null;
function nameKind(a: string, b: string): Kind {
  if (!a || !b) return null;
  if (a === b) return 'exact';
  const sa = skeleton(a), sb = skeleton(b);
  if (sa && sa === sb) return 'similar';
  if (Math.min(a.length, b.length) >= 5 && distance(a, b) <= 1) return 'similar';
  const ta = a.split(' '), tb = b.split(' ');
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  // every word of the shorter name appears in the longer one, and it is more than a single very short word
  if (short.length >= 1 && short.join('').length >= 3 && short.every((w) => long.includes(w)) && long.length - short.length <= 2) return 'partial';
  return null;
}
const phoneKey = (g: Guest) => { const p = normPhone(g.phone); return p ? p.replace(/^0+/, '').slice(-9) : null; };
const names = (g: Guest) => [...new Set([normName(g.family_name), normName(g.contact_name)].filter(Boolean))];
const answered = (g: Guest) => g.status !== 'pending';

/** Compares two records. Null when nothing ties them together. */
export function compare(a: Guest, b: Guest): Match | null {
  const pa = phoneKey(a), pb = phoneKey(b);
  const samePhone = !!pa && pa === pb;
  let kind: Kind = null;
  for (const x of names(a)) for (const y of names(b)) {
    const k = nameKind(x, y);
    if (k === 'exact' || (k === 'similar' && kind !== 'exact') || (k === 'partial' && !kind)) kind = k;
  }
  const reasons: string[] = [];
  let confidence: Confidence;
  if (samePhone) {
    reasons.push('אותו מספר טלפון');
    if (kind === 'exact') { reasons.push('אותו שם'); confidence = 'very_high'; }
    else if (kind) { reasons.push('שם דומה'); confidence = 'very_high'; }
    else { reasons.push('שמות שונים: אולי בני משפחה שחולקים טלפון'); confidence = 'high'; }
  } else if (kind === 'exact') {
    reasons.push('אותו שם');
    if (!pa || !pb) { reasons.push(pa || pb ? 'לאחד מהם אין טלפון' : 'לשניהם אין טלפון'); confidence = 'high'; }
    else { reasons.push('מספרי טלפון שונים'); confidence = 'medium'; }
  } else if (kind === 'similar') {
    reasons.push('שם כמעט זהה (הבדל באיות או בהקלדה)');
    confidence = !pa || !pb ? 'medium' : 'low';
    if (pa && pb) reasons.push('מספרי טלפון שונים');
  } else if (kind === 'partial' && (!pa || !pb)) {
    reasons.push('שם אחד כלול בשני', 'לאחד מהם אין טלפון');
    confidence = 'low';
  } else return null;
  const critical = answered(a) && answered(b) && (a.status !== b.status || a.adults + a.children !== b.adults + b.children);
  if (critical) reasons.push('תשובות שונות: אחד מהם נספר פעמיים או לא נכון');
  return { a: a.id, b: b.id, confidence, reasons, critical };
}

export const pairKey = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);

/** Every group of records tied together by at least one match that was not dismissed. Strongest groups first. */
export function findDuplicates(guests: Guest[], dismissed: Set<string> = new Set(), min: Confidence = 'low'): DupGroup[] {
  const matches: Match[] = [];
  for (let i = 0; i < guests.length; i++) for (let j = i + 1; j < guests.length; j++) {
    if (dismissed.has(pairKey(guests[i].id, guests[j].id))) continue;
    const m = compare(guests[i], guests[j]);
    if (m && RANK[m.confidence] >= RANK[min]) matches.push(m);
  }
  const parent = new Map<string, string>();
  const find = (x: string): string => { const p = parent.get(x) ?? x; if (p === x) return x; const r = find(p); parent.set(x, r); return r; };
  for (const m of matches) { const ra = find(m.a), rb = find(m.b); if (ra !== rb) parent.set(ra, rb); }
  const groups = new Map<string, DupGroup>();
  const order = new Map(guests.map((g, i) => [g.id, i]));
  for (const m of matches) {
    const root = find(m.a);
    const g = groups.get(root) ?? { ids: [], confidence: 'low' as Confidence, reasons: [], critical: false, key: '' };
    for (const id of [m.a, m.b]) if (!g.ids.includes(id)) g.ids.push(id);
    if (RANK[m.confidence] > RANK[g.confidence]) g.confidence = m.confidence;
    for (const r of m.reasons) if (!g.reasons.includes(r)) g.reasons.push(r);
    g.critical ||= m.critical;
    groups.set(root, g);
  }
  return [...groups.values()].map((g) => ({ ...g, ids: g.ids.sort((x, y) => (order.get(x) ?? 0) - (order.get(y) ?? 0)), key: [...g.ids].sort().join('|') }))
    .sort((x, y) => Number(y.critical) - Number(x.critical) || RANK[y.confidence] - RANK[x.confidence] || y.ids.length - x.ids.length);
}

/** Ids of every record that sits in some group: for the badge in the list. */
export const duplicateIds = (groups: DupGroup[]) => new Set(groups.flatMap((g) => g.ids));

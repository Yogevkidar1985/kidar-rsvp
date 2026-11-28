import { describe, expect, it } from 'vitest';
import { compare, duplicateIds, findDuplicates, normName, pairKey } from '../src/lib/duplicates';
import { hebrewDate, weekdayLabel, dateParts } from '@/lib/hebrew-date';
import { normPhone, intlPhone } from '@/lib/phone';
import { rsvpSchema, safeHttpUrl } from '@/lib/validation';
import { computeStats, seats, tableLoad } from '@/lib/stats';
import { guestRows, seatingRows, toCsv, inert } from '@/lib/export';
import { buildMessage } from '@/lib/messages';
import { googleCalendarUrl, icsFile } from '@/lib/calendar';
import { fontsHref } from '@/lib/fonts';
import { resolveDesign, DEFAULT_DESIGN } from '@/lib/defaults';
import { successLottie } from '@/components/invitation/successLottie';
import type { EventContent, Guest, TableRow } from '@/lib/types';

const g = (o: Partial<Guest>): Guest => ({
  id: Math.random().toString(36), event_id: 'e', family_name: 'כהן', contact_name: null, phone: null, allocated_seats: null,
  adults: 0, children: 0, babies: 0, status: 'pending', responded_at: null, arrived: false, arrived_count: null, arrived_at: null,
  table_id: null, notes: null, preferences: null, admin_notes: null, is_vip: false, group_name: null, invite_token: 'x', source: 'admin',
  created_at: '', updated_at: '', ...o,
});

describe('dates', () => {
  it('computes the Hebrew date of the Kidar event', () => {
    const h = hebrewDate('2026-12-02');
    expect(h).toBe('כ״ב בכסלו התשפ״ז');
    expect(weekdayLabel('2026-12-02')).toBe('יום רביעי');
    expect(dateParts('2026-12-02')).toMatchObject({ day: '2', month: 'דצמבר', year: '2026', numeric: '02.12.2026' });
  });
  it('handles another known date and bad input', () => {
    expect(hebrewDate('2026-07-08')).toBe('כ״ג בתמוז התשפ״ו');
    expect(hebrewDate('nope')).toBe('');
    expect(dateParts('2026-02-31')).toBeNull();
  });
});

describe('phones', () => {
  it('normalises Israeli formats to one key', () => {
    for (const p of ['054-304-9491', '+972 54 3049491', '972543049491', '0543049491']) expect(normPhone(p)).toBe('0543049491');
    expect(normPhone('123')).toBeNull();
    expect(intlPhone('054-3049491')).toBe('972543049491');
  });
});

describe('rsvp validation', () => {
  const base = { slug: 'kidar-brit', name: 'דנה לוי', phone: '0501234567', status: 'attending', adults: 2, children: 1, babies: 0 };
  it('accepts a normal answer', () => expect(rsvpSchema.safeParse(base).success).toBe(true));
  it('rejects attending with nobody, bad phone, bad token, scripts in slug', () => {
    expect(rsvpSchema.safeParse({ ...base, adults: 0, children: 0 }).success).toBe(false);
    expect(rsvpSchema.safeParse({ ...base, phone: 'abc' }).success).toBe(false);
    expect(rsvpSchema.safeParse({ ...base, token: "x' or 1=1" }).success).toBe(false);
    expect(rsvpSchema.safeParse({ ...base, slug: '<script>' }).success).toBe(false);
    expect(rsvpSchema.safeParse({ ...base, adults: -1 }).success).toBe(false);
    expect(rsvpSchema.safeParse({ ...base, notes: 'x'.repeat(501) }).success).toBe(false);
  });
  it('only lets http(s) links through', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('https://waze.com/ul?q=x')).toBe('https://waze.com/ul?q=x');
  });
});

describe('stats', () => {
  const list = [
    g({ status: 'attending', adults: 2, children: 2, babies: 1, allocated_seats: 5 }),
    g({ status: 'attending', adults: 1, allocated_seats: 2, arrived: true, arrived_count: 1 }),
    g({ status: 'maybe', adults: 2, allocated_seats: 2 }),
    g({ status: 'declined', allocated_seats: 4 }),
    g({ status: 'pending', allocated_seats: 3 }),
    g({ status: 'pending' }),
  ];
  it('counts people, families and seats', () => {
    const s = computeStats(list);
    expect(s).toMatchObject({
      families: 6, invitedTotal: 5 + 2 + 2 + 4 + 3 + 1, attendingPeople: 6, attendingFamilies: 2, declinedPeople: 4,
      pendingPeople: 4, pendingFamilies: 2, maybeFamilies: 1, responseRate: 67, adults: 3, children: 2, babies: 1,
      allocatedSeats: 16, confirmedSeats: 5, arrivedFamilies: 1, arrivedPeople: 1,
    });
    expect(computeStats([]).responseRate).toBe(0);
  });
  it('babies take no chair; pending holds its allocation', () => {
    expect(seats(list[0])).toBe(4); expect(seats(list[3])).toBe(0); expect(seats(list[4])).toBe(3); expect(seats(list[2])).toBe(2);
    const t: TableRow = { id: 't1', event_id: 'e', name: '1', capacity: 6, pos_x: 0, pos_y: 0, shape: 'round' };
    const l = tableLoad(t, [{ ...list[0], table_id: 't1' }, { ...list[4], table_id: 't1' }]);
    expect(l).toMatchObject({ used: 7, free: -1, over: true });
  });
});

describe('export', () => {
  const tables: TableRow[] = [{ id: 't1', event_id: 'e', name: 'שולחן 1', capacity: 10, pos_x: 0, pos_y: 0, shape: 'round' }];
  const list = [g({ family_name: 'לוי', status: 'attending', adults: 2, children: 1, table_id: 't1', notes: '=HYPERLINK("http://x")' }), g({ family_name: 'אבני', status: 'declined' })];
  it('filters by scope and picks columns', () => {
    const rows = guestRows(list, tables, 'attending', ['family_name', 'total', 'status', 'table']);
    expect(rows).toEqual([['שם משפחה', 'סה״כ משתתפים', 'סטטוס', 'שולחן'], ['לוי', 3, 'מגיעים', 'שולחן 1']]);
    expect(guestRows(list, tables, 'all', ['family_name'])).toHaveLength(3);
  });
  it('neutralises spreadsheet formulas typed by guests', () => {
    expect(inert('=1+1')).toBe("'=1+1");
    expect(toCsv(guestRows(list, tables, 'attending', ['notes']))).toContain(`"'=HYPERLINK(""http://x"")"`);
  });
  it('lists seating with free places', () => {
    expect(seatingRows(list, tables)[1].slice(0, 5)).toEqual(['שולחן 1', 10, 3, 7, 'לוי']);
  });
});

describe('notifications and calendar', () => {
  it('describes a count change', () => {
    const m = buildMessage('count_change', 'ברית', { family_name: 'לוי', status: 'attending', adults: 3, children: 0, babies: 0 }, { status: 'attending', adults: 2, children: 0, babies: 0 }, { attendingPeople: 30, attendingFamilies: 9 });
    expect(m).toContain('שינוי בכמות המשתתפים'); expect(m).toContain('קודם: מבוגרים 2'); expect(m).toContain('30 אנשים');
    expect(m).toContain('שם האורח: לוי'); expect(m).not.toContain('משפחה:'); expect(m).toContain('30 אנשים, 9 אישורים');
    expect(buildMessage('rsvp_new', 'ברית', { family_name: 'Yogev Kidar', status: 'attending', adults: 1, children: 0, babies: 0 }, null, { attendingPeople: 1, attendingFamilies: 1 })).toContain('סה״כ מגיעים עד כה: אדם אחד, אישור אחד');
  });
  const ev = { id: 'id', name: 'ברית', event_date: '2026-12-02', reception_time: '15:00', ceremony_time: null, end_time: null, venue_name: 'אולם', address: 'רחוב 1; עיר' } as EventContent;
  it('builds calendar entries in Israel time', () => {
    expect(googleCalendarUrl(ev)).toContain('dates=20261202T150000%2F20261202T180000');
    const ics = icsFile(ev)!;
    expect(ics).toContain('DTSTART;TZID=Asia/Jerusalem:20261202T150000'); expect(ics).toContain('LOCATION:אולם\\, רחוב 1\\; עיר');
    expect(googleCalendarUrl({ ...ev, event_date: null })).toBeNull();
  });
});

describe('design', () => {
  it('fills gaps in a partial design and ignores unknown fonts', () => {
    const d = resolveDesign({ colors: { bg: '#000000' } as never });
    expect(d.colors.bg).toBe('#000000'); expect(d.colors.ink).toBe(DEFAULT_DESIGN.colors.ink); expect(d.fall.kind).toBe('confetti');
    expect(resolveDesign({ font: 'David Libre' } as never).styles.headline.font).toBe('Heebo');
    expect(fontsHref(['Bellefair', 'Evil"><script>'])).toBe('https://fonts.googleapis.com/css2?family=Bellefair&display=swap');
  });
  it('produces a well-formed Lottie document', () => {
    const l = successLottie('#2F7D5B');
    expect(l.layers.map((x) => x.nm)).toEqual(['check', 'disc', 'rays', 'ring']); expect(l.op).toBe(90);
    expect(JSON.stringify(l)).not.toContain('undefined');
  });
});

describe('duplicate detection', () => {
  const g = (id: string, family_name: string, phone: string | null, extra: Record<string, unknown> = {}) =>
    ({ id, event_id: 'e', family_name, contact_name: null, phone, status: 'pending', adults: 0, children: 0, babies: 0, ...extra }) as never;
  it('treats one phone written four ways as one phone', () => {
    const list = [g('1', 'דוד כהן', '054-304-9491'), g('2', 'דוד כהן', '0543049491'), g('3', 'דוד  כהן', '+972543049491'), g('4', 'כהן דוד', '972543049491')];
    const groups = findDuplicates(list);
    expect(groups).toHaveLength(1); expect(groups[0].ids).toHaveLength(4); expect(groups[0].confidence).toBe('very_high');
    expect(groups[0].reasons).toContain('אותו מספר טלפון');
  });
  it('folds spacing, punctuation, "family of" and final letters in names', () => {
    expect(normName('משפחת  כהן')).toBe(normName('כהן')); expect(normName('דוד כהן')).toBe(normName('כהן, דוד'));
    expect(normName('David  COHEN')).toBe('cohen david'); expect(normName('אברהם')).toBe(normName('אברהמ'));
  });
  it('says why, and never ranks a name alone as certain', () => {
    const sameName = compare(g('1', 'דוד כהן', '0501111111'), g('2', 'דוד כהן', '0502222222'))!;
    expect(sameName.confidence).toBe('medium'); expect(sameName.reasons).toEqual(['אותו שם', 'מספרי טלפון שונים']);
    const noPhone = compare(g('1', 'רונית שמש', null), g('2', 'רונית שמש', '0501111111'))!;
    expect(noPhone.confidence).toBe('high'); expect(noPhone.reasons).toContain('לאחד מהם אין טלפון');
    const spelling = compare(g('1', 'משפחת כוהן', null), g('2', 'משפחת כהן', null))!;
    expect(spelling.reasons[0]).toContain('כמעט זהה');
    expect(compare(g('1', 'דוד כהן', '0501111111'), g('2', 'שרה לוי', '0502222222'))).toBeNull();
  });
  it('flags a shared phone with different names for review instead of assuming one person', () => {
    const m = compare(g('1', 'דוד כהן', '0501111111'), g('2', 'שרה לוי', '050-1111111'))!;
    expect(m.confidence).toBe('high'); expect(m.reasons.join()).toContain('שמות שונים');
  });
  it('marks conflicting answers as critical and puts them first', () => {
    const list = [g('1', 'אבי לוי', null), g('2', 'אבי לוי', null), g('3', 'דנה רז', '0501111111', { status: 'attending', adults: 2 }), g('4', 'דנה רז', '0501111111', { status: 'declined' })];
    const groups = findDuplicates(list);
    expect(groups[0].ids).toEqual(['3', '4']); expect(groups[0].critical).toBe(true); expect(groups[1].critical).toBe(false);
  });
  it('leaves out pairs a person marked as different people', () => {
    const list = [g('1', 'דוד כהן', '0501111111'), g('2', 'דוד כהן', '0502222222')];
    expect(findDuplicates(list, new Set([pairKey('2', '1')]))).toHaveLength(0);
    expect(duplicateIds(findDuplicates(list)).size).toBe(2);
  });
});

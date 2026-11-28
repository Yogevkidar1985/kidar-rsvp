import { describe, expect, it } from 'vitest';
import { wallTime, eventStart } from '@/lib/when';
import { BUILTIN, TEMPLATE_GROUPS, render, templateGroup, variables } from '@/lib/templates';

describe('event time in Israel', () => {
  it('follows winter and summer time', () => {
    expect(wallTime('2026-12-02', '15:00')!.toISOString()).toBe('2026-12-02T13:00:00.000Z'); // winter, UTC+2
    expect(wallTime('2026-07-08', '18:00')!.toISOString()).toBe('2026-07-08T15:00:00.000Z'); // summer, UTC+3
  });
  it('is right on both sides of the clock changes', () => {
    expect(wallTime('2026-03-26', '23:00')!.toISOString()).toBe('2026-03-26T21:00:00.000Z'); // the evening before clocks go forward
    expect(wallTime('2026-03-27', '12:00')!.toISOString()).toBe('2026-03-27T09:00:00.000Z'); // the day they went forward
    expect(wallTime('2026-10-24', '20:00')!.toISOString()).toBe('2026-10-24T17:00:00.000Z'); // the evening before clocks go back
    expect(wallTime('2026-10-25', '12:00')!.toISOString()).toBe('2026-10-25T10:00:00.000Z'); // the day they went back
  });
  it('counts 24 real hours back across a clock change', () => {
    const start = eventStart({ event_date: '2026-10-25', reception_time: '12:00', ceremony_time: null })!;
    expect(new Date(start.getTime() - 24 * 3600000).toISOString()).toBe('2026-10-24T10:00:00.000Z'); // 13:00 on the Israeli clock the day before
  });
  it('refuses a date or time it cannot read', () => {
    expect(wallTime('02/12/2026', '15:00')).toBeNull();
    expect(eventStart({ event_date: '2026-12-02', reception_time: null, ceremony_time: null })).toBeNull();
  });
});

describe('message templates', () => {
  const ev = { slug: 'kidar-brit', name: 'מסיבת הברית', hosts: 'יוגב ואביה קידר', event_date: '2026-12-02', weekday_label: 'יום רביעי', hebrew_date: 'כ״ב בכסלו התשפ״ז',
    reception_time: '15:00', ceremony_time: null, venue_name: null, address: null, waze_url: null, gmaps_url: null };
  it('has thirteen invitations and six reminders ready, each under its own name', () => {
    expect(BUILTIN.filter((t) => t.kind === 'invite')).toHaveLength(13);
    expect(BUILTIN.filter((t) => t.kind === 'reminder')).toHaveLength(6);
    expect(new Set(BUILTIN.map((t) => t.id)).size).toBe(BUILTIN.length); expect(new Set(BUILTIN.map((t) => t.name)).size).toBe(BUILTIN.length);
  });
  it('fills every built-in invitation from the event and the guest', () => {
    const v = variables(ev, { family_name: 'משפחת לוי', contact_name: 'דנה', invite_token: 'abc123' }, 'https://example.com/');
    const full = variables({ ...ev, venue_name: 'Tesoro', address: 'משה סנה 199, רמת השרון' } as never, { family_name: 'משפחת לוי', contact_name: 'דנה', invite_token: 'abc123' }, 'https://example.com/');
    for (const t of BUILTIN.filter((x) => x.kind === 'invite')) {
      const r = render(t.body, full);
      expect(r.missing).toEqual([]);
      expect(r.text).toContain('https://example.com/e/kidar-brit?g=abc123');
      expect(r.text.includes('{{') || r.text.includes('undefined')).toBe(false);
    }
    expect(render(BUILTIN[0].body, v).text).toContain('שלום דנה,');
    expect(render(BUILTIN[3].body, v).text).toContain('יום רביעי, 2 בדצמבר 2026');
  });
  it('reports a variable with no value instead of sending a broken message', () => {
    const v = variables(ev, { family_name: 'משפחת לוי' }, 'https://example.com');
    expect(render('ניווט: {{waze_url}} {{nope}}', v).missing).toEqual(['waze_url', 'nope']);
    expect(render(BUILTIN.find((t) => t.id === 'builtin:day-before')!.body, v).missing).toEqual(['waze_url']);
    expect(variables({ ...ev, venue_name: 'אולם', address: 'הרצל 1' }, { family_name: 'x' }, 'https://example.com').waze_url).toContain('waze.com/ul?q=');
  });
});

describe('the warmer templates', () => {
  it('use a few emojis, never a crowd of them', () => {
    const emoji = /\p{Extended_Pictographic}/gu;
    for (const t of BUILTIN) expect((t.body.match(emoji) ?? []).length, t.name).toBeLessThanOrEqual(6);
    expect(BUILTIN.filter((t) => emoji.test(t.body)).length).toBeGreaterThanOrEqual(9);
  });
  it('refuse to go out while the venue they mention is missing', () => {
    const bare = { id: 'e', slug: 'kidar-brit', name: 'ברית', hosts: 'יוגב ואביה', event_date: '2026-12-02', weekday_label: 'יום רביעי', hebrew_date: 'כ״ב בכסלו', reception_time: '15:00', ceremony_time: null, venue_name: null, address: null, waze_url: null, gmaps_url: null };
    const r = render(BUILTIN.find((t) => t.id === 'builtin:warm')!.body, variables(bare as never, { family_name: 'לוי', contact_name: 'דנה' }, 'https://example.com'));
    expect(r.missing).toEqual(['venue_name']);
  });
});

describe('the library groups', () => {
  it('put every ready text in a group that exists, and leave none empty', () => {
    const keys = TEMPLATE_GROUPS.map((g) => g.key);
    for (const t of BUILTIN) expect(keys).toContain(templateGroup(t));
    for (const k of keys) expect(BUILTIN.some((t) => templateGroup(t) === k), k).toBe(true);
  });
});

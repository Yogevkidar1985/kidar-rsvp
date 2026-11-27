import type { EventContent } from './types';

const pad = (n: number) => String(n).padStart(2, '0');
function stamps(ev: EventContent): { start: string; end: string } | null {
  if (!ev.event_date) return null;
  const d = ev.event_date.replace(/-/g, '');
  const t = (s: string | null) => { const m = /^(\d{1,2}):(\d{2})/.exec(s ?? ''); return m ? [+m[1], +m[2]] : null; };
  const s = t(ev.reception_time) ?? t(ev.ceremony_time) ?? [12, 0];
  const e = t(ev.end_time) ?? [Math.min(s[0] + 3, 23), s[1]];
  return { start: `${d}T${pad(s[0])}${pad(s[1])}00`, end: `${d}T${pad(e[0])}${pad(e[1])}00` };
}
const where = (ev: EventContent) => [ev.venue_name, ev.address].filter(Boolean).join(', ');

export function googleCalendarUrl(ev: EventContent): string | null {
  const s = stamps(ev);
  if (!s) return null;
  const p = new URLSearchParams({ action: 'TEMPLATE', text: ev.name, dates: `${s.start}/${s.end}`, ctz: 'Asia/Jerusalem', location: where(ev) });
  return `https://calendar.google.com/calendar/render?${p}`;
}
const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/([,;])/g, '\\$1').replace(/\r?\n/g, '\\n');
export function icsFile(ev: EventContent): string | null {
  const s = stamps(ev);
  if (!s) return null;
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//KIDAR RSVP//HE', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:${ev.id}@rsvp`, `DTSTAMP:${s.start}Z`, `DTSTART;TZID=Asia/Jerusalem:${s.start}`, `DTEND;TZID=Asia/Jerusalem:${s.end}`,
    `SUMMARY:${esc(ev.name)}`, `LOCATION:${esc(where(ev))}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

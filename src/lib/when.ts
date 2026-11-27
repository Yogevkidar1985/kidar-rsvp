/** The moment an event starts, given its calendar date and wall-clock time in Israel. */
export const EVENT_TZ = 'Asia/Jerusalem';

function offsetMinutes(at: Date, tz: string): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(at).map((x) => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - at.getTime()) / 60000;
}
/** `date` is YYYY-MM-DD and `time` is HH:MM, both as read on a clock in `tz`. Follows daylight saving. */
export function wallTime(date: string, time: string, tz = EVENT_TZ): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date), t = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!d || !t) return null;
  const guess = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]);
  let at = new Date(guess - offsetMinutes(new Date(guess), tz) * 60000);
  at = new Date(guess - offsetMinutes(at, tz) * 60000); // second pass settles the hours around a clock change
  return at;
}
export function eventStart(ev: { event_date: string | null; reception_time: string | null; ceremony_time: string | null }): Date | null {
  const time = ev.reception_time || ev.ceremony_time;
  return ev.event_date && time ? wallTime(ev.event_date, time) : null;
}
export const fmtWhen = (at: Date | string) =>
  new Intl.DateTimeFormat('he-IL', { timeZone: EVENT_TZ, weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(at));

import { dateParts } from './hebrew-date';
import { safeHttpUrl } from './validation';

export type TemplateKind = 'invite' | 'reminder';
export type Template = { id: string; kind: TemplateKind; name: string; body: string; is_default?: boolean; builtin?: boolean };

export const VARIABLES: { key: string; label: string }[] = [
  { key: 'guest_name', label: 'שם האורח' }, { key: 'family_name', label: 'שם המשפחה' }, { key: 'event_name', label: 'שם האירוע' },
  { key: 'hosts', label: 'המארחים' }, { key: 'weekday', label: 'יום בשבוע' }, { key: 'event_date', label: 'תאריך' },
  { key: 'event_date_long', label: 'תאריך במילים' }, { key: 'hebrew_date', label: 'תאריך עברי' }, { key: 'event_time', label: 'שעה' },
  { key: 'venue_name', label: 'שם המקום' }, { key: 'venue_address', label: 'כתובת' }, { key: 'invitation_url', label: 'קישור להזמנה' },
  { key: 'waze_url', label: 'קישור Waze' }, { key: 'maps_url', label: 'קישור Google Maps' },
];

const b = (id: string, kind: TemplateKind, name: string, body: string): Template => ({ id: `builtin:${id}`, kind, name, body, builtin: true });
/** Ready-made texts. Dates, time and links come from the event, so they follow any change made in the editor. */
export const BUILTIN: Template[] = [
  b('elegant', 'invite', 'הזמנה אלגנטית', `שלום {{guest_name}},

בשעה טובה, זכינו להרחיב את המשפחה!

נשמח להזמין אתכם לחגוג איתנו את מסיבת הברית של בננו.

{{weekday}}, {{event_date}}
{{hebrew_date}}
בשעה {{event_time}}

{{hosts}}

להזמנה המלאה ולאישור הגעה:
{{invitation_url}}

מחכים לראותכם!`),
  b('friendly', 'invite', 'קצרה וחברית', `היי {{guest_name}},

אנחנו מתרגשים להזמין אתכם למסיבת הברית של בננו!

{{event_date}} | {{weekday}}
{{hebrew_date}}
{{event_time}}

כל הפרטים ואישור הגעה בקישור:
{{invitation_url}}

מחכים לחגוג איתכם,
{{hosts}}`),
  b('family', 'invite', 'אישית למשפחה', `{{guest_name}} היקרים,

בשעה טובה נולד לנו בן ואנחנו מזמינים אתכם להיות חלק מהרגע המשמח שלנו.

נשמח לראותכם במסיבת הברית:

{{weekday}} | {{event_date}}
{{hebrew_date}}
{{event_time}}

לפרטים נוספים ולאישור הגעה:
{{invitation_url}}

באהבה,
{{hosts}}`),
  b('formal', 'invite', 'רשמית', `הנכם מוזמנים באהבה למסיבת הברית של בננו.

{{hosts}}

{{weekday}}, {{event_date_long}}
{{hebrew_date}}
בשעה {{event_time}}

לצפייה בהזמנה ולאישור הגעה:
{{invitation_url}}

נשמח לחגוג יחד אתכם.`),
  b('short', 'invite', 'הודעה קצרה', `{{guest_name}} שלום!

אנחנו מזמינים אתכם לחגוג איתנו את מסיבת הברית של בננו.

{{event_date}} בשעה {{event_time}}

כל הפרטים ואישור הגעה:
{{invitation_url}}

מחכים לראותכם,
{{hosts}}`),
  b('day-before', 'reminder', 'יום לפני', `היי {{guest_name}}!

מחר נפגשים!

אנחנו מתרגשים להזכיר לכם שמחר נחגוג יחד את מסיבת הברית של בננו.

{{weekday}}, {{event_date}}
בשעה {{event_time}}

לפרטי האירוע והגעה:
{{invitation_url}}

לניווט:
{{waze_url}}

מחכים לראותכם!

{{hosts}}`),
  b('hours-before', 'reminder', 'כמה שעות לפני', `היי {{guest_name}}!

תזכורת קטנה שאנחנו נפגשים היום!

מסיבת הברית של בננו
היום בשעה {{event_time}}

כל הפרטים והניווט:
{{invitation_url}}

Waze:
{{waze_url}}

מחכים לכם,
{{hosts}}`),
  b('brief', 'reminder', 'תזכורת קצרה', `היי {{guest_name}},

רק מזכירים שהיום נפגשים במסיבת הברית שלנו!

בשעה {{event_time}}.

לניווט ולפרטים:
{{invitation_url}}

מחכים לראותכם,
{{hosts}}`),
];

export type EventForMessage = {
  slug: string; name: string; hosts: string | null; event_date: string | null; weekday_label: string | null; hebrew_date: string | null;
  reception_time: string | null; ceremony_time: string | null; venue_name: string | null; address: string | null;
  waze_url: string | null; gmaps_url: string | null;
};
export type GuestForMessage = { family_name: string; contact_name?: string | null; invite_token?: string | null; link_code?: string | null };

/** The address a guest receives: short when they have a code, the original form otherwise. `test` opens it in test mode. */
export function inviteUrl(siteUrl: string, slug: string, guest?: { invite_token?: string | null; link_code?: string | null } | null, test = false): string {
  const base = siteUrl.replace(/\/+$/, '');
  if (!base) return '';
  const url = guest?.link_code ? `${base}/${slug}/${guest.link_code}` : guest?.invite_token ? `${base}/e/${slug}?g=${guest.invite_token}` : `${base}/${slug}`;
  return test ? url + (url.includes('?') ? '&' : '?') + 'test=1' : url;
}

/** Values for every variable. An empty string means the event or the guest has nothing to put there. */
export function variables(ev: EventForMessage, guest: GuestForMessage, siteUrl: string, test = false): Record<string, string> {
  const d = dateParts(ev.event_date);
  const place = [ev.venue_name, ev.address].filter(Boolean).join(', ');
  return {
    guest_name: (guest.contact_name || guest.family_name || '').trim(), family_name: (guest.family_name || '').trim(),
    event_name: ev.name ?? '', hosts: ev.hosts ?? '', weekday: ev.weekday_label ?? '',
    event_date: d?.numeric ?? '', event_date_long: d ? `${d.day} ב${d.month} ${d.year}` : '', hebrew_date: ev.hebrew_date ?? '',
    event_time: ev.reception_time || ev.ceremony_time || '', venue_name: ev.venue_name ?? '', venue_address: ev.address ?? '',
    invitation_url: inviteUrl(siteUrl, ev.slug, guest, test),
    waze_url: safeHttpUrl(ev.waze_url) ?? (place ? `https://waze.com/ul?q=${encodeURIComponent(place)}&navigate=yes` : ''),
    maps_url: safeHttpUrl(ev.gmaps_url) ?? (place ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}` : ''),
  };
}

/** Fills a template. `missing` lists variables that are unknown or have no value: such a message must not be sent. */
export function render(body: string, vars: Record<string, string>): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const text = body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k: string) => {
    const v = vars[k];
    if (!v) { missing.add(k); return ''; }
    return v;
  }).replace(/\n{3,}/g, '\n\n').trim();
  if (/\{\{|\}\}/.test(text)) missing.add('סוגריים לא סגורים');
  return { text, missing: [...missing] };
}
export const variableLabel = (k: string) => VARIABLES.find((v) => v.key === k)?.label ?? k;

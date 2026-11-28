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

/** How the library is laid out: what a text is for, and when it is the right one to send. */
export const TEMPLATE_GROUPS = [
  { key: 'invite', label: 'הזמנות', hint: 'ההודעה הראשונה, עם הקישור להזמנה ולאישור ההגעה.' },
  { key: 'follow', label: 'מעקב למי שלא ענה', hint: 'בשליחה מסננים "טרם ענו" ומסמנים "שליחה חוזרת", כי המשפחות האלה כבר קיבלו הזמנה.' },
  { key: 'update', label: 'עדכונים', hint: 'שינוי בשעה או במקום. מסמנים "שליחה חוזרת" כדי שיגיע גם למי שכבר הוזמן.' },
  { key: 'reminder', label: 'תזכורות לפני האירוע', hint: 'נשלחות רק למי שאישר הגעה, במועד שקובעים במסך התזכורות.' },
] as const;
export type TemplateGroup = (typeof TEMPLATE_GROUPS)[number]['key'];
export const templateGroup = (t: Pick<Template, 'id' | 'kind'>): TemplateGroup =>
  t.kind === 'reminder' ? 'reminder' : /^builtin:(nudge|last-call)$/.test(t.id) ? 'follow' : t.id === 'builtin:update' ? 'update' : 'invite';

const b = (id: string, kind: TemplateKind, name: string, body: string): Template => ({ id: `builtin:${id}`, kind, name, body, builtin: true });
/** Ready-made texts. Dates, time and links come from the event, so they follow any change made in the editor. */
export const BUILTIN: Template[] = [
  b('elegant', 'invite', 'הזמנה אלגנטית', `שלום {{guest_name}},

בשעה טובה, זכינו להרחיב את המשפחה!

נשמח להזמין אתכם לחגוג איתנו את מסיבת הברית של בננו.

{{weekday}}, {{event_date}}
{{hebrew_date}}
קבלת פנים בשעה {{event_time}}

{{hosts}}

להזמנה המלאה ולאישור הגעה:
{{invitation_url}}

מחכים לראותכם!`),
  b('friendly', 'invite', 'קצרה וחברית', `היי {{guest_name}},

אנחנו מתרגשים להזמין אתכם למסיבת הברית של בננו! 🎉

{{event_date}} | {{weekday}}
{{hebrew_date}}
קבלת פנים בשעה {{event_time}}

כל הפרטים ואישור הגעה בקישור:
{{invitation_url}}

מחכים לחגוג איתכם 😊
{{hosts}}`),
  b('family', 'invite', 'אישית למשפחה', `{{guest_name}} היקרים,

בשעה טובה נולד לנו בן ואנחנו מזמינים אתכם להיות חלק מהרגע המשמח שלנו.

נשמח לראותכם במסיבת הברית:

{{weekday}} | {{event_date}}
{{hebrew_date}}
קבלת פנים בשעה {{event_time}}

לפרטים נוספים ולאישור הגעה:
{{invitation_url}}

באהבה ❤️
{{hosts}}`),
  b('formal', 'invite', 'רשמית', `הנכם מוזמנים באהבה למסיבת הברית של בננו.

{{hosts}}

{{weekday}}, {{event_date_long}}
{{hebrew_date}}
קבלת פנים בשעה {{event_time}}

לצפייה בהזמנה ולאישור הגעה:
{{invitation_url}}

נשמח לחגוג יחד אתכם.`),
  b('short', 'invite', 'הודעה קצרה', `{{guest_name}} שלום!

אנחנו מזמינים אתכם לחגוג איתנו את מסיבת הברית של בננו.

{{event_date}}, קבלת פנים בשעה {{event_time}}

כל הפרטים ואישור הגעה:
{{invitation_url}}

מחכים לראותכם,
{{hosts}}`),
  b('day-before', 'reminder', 'יום לפני', `היי {{guest_name}}!

מחר נפגשים! 🎉

אנחנו מתרגשים להזכיר לכם שמחר נחגוג יחד את מסיבת הברית של בננו.

{{weekday}}, {{event_date}}
קבלת פנים בשעה {{event_time}}

לפרטי האירוע והגעה:
{{invitation_url}}

לניווט:
{{waze_url}}

מחכים לראותכם!

{{hosts}}`),
  b('hours-before', 'reminder', 'כמה שעות לפני', `היי {{guest_name}}!

תזכורת קטנה שאנחנו נפגשים היום! ⏰

מסיבת הברית של בננו
היום, קבלת פנים בשעה {{event_time}}

כל הפרטים והניווט:
{{invitation_url}}

Waze:
{{waze_url}}

מחכים לכם,
{{hosts}}`),
  b('brief', 'reminder', 'תזכורת קצרה', `היי {{guest_name}},

רק מזכירים שהיום נפגשים במסיבת הברית שלנו! 😊

קבלת פנים בשעה {{event_time}}.

לניווט ולפרטים:
{{invitation_url}}

מחכים לראותכם,
{{hosts}}`),
  // ---- warmer texts, with a few emojis: enough to sound like a person, never a row of them ----
  b('warm', 'invite', 'חמה עם אימוג׳י', `היי {{guest_name}} 😊

בשעה טובה נולד לנו בן, ואנחנו מתרגשים להזמין אתכם לחגוג איתנו את מסיבת הברית!

📅 {{weekday}}, {{event_date}}
🕒 קבלת פנים בשעה {{event_time}}
📍 {{venue_name}}

נשמח מאוד לראות אתכם ❤️

לפרטים ולאישור הגעה:
{{invitation_url}}

{{hosts}}`),
  b('close-family', 'invite', 'למשפחה הקרובה', `{{guest_name}} היקרים ❤️

אתם חלק מהשמחה שלנו, ואין לנו ספק שנחגוג יחד.

מסיבת הברית של בננו תתקיים ב{{weekday}}, {{event_date}} ({{hebrew_date}}), קבלת פנים בשעה {{event_time}}, ב-{{venue_name}}.

כדי שנדע להיערך, נשמח שתאשרו כאן כמה תגיעו:
{{invitation_url}}

אוהבים,
{{hosts}}`),
  b('friends', 'invite', 'לחברים', `היי {{guest_name}}! 🥳

יש לנו בן, ויש לנו מסיבה.

{{event_date}} · קבלת פנים {{event_time}} · {{venue_name}}

בואו לחגוג איתנו. כל הפרטים ואישור הגעה כאן:
{{invitation_url}}

מחכים לכם,
{{hosts}}`),
  b('colleagues', 'invite', 'לעמיתים לעבודה', `שלום {{guest_name}},

שמחים לשתף שנולד לנו בן, ונשמח לראותך במסיבת הברית.

📅 {{weekday}}, {{event_date}}
🕒 קבלת פנים בשעה {{event_time}}
📍 {{venue_name}}, {{venue_address}}

להזמנה ולאישור הגעה:
{{invitation_url}}

בברכה,
{{hosts}}`),
  b('with-directions', 'invite', 'עם ניווט למקום', `היי {{guest_name}} 😊

מוזמנים למסיבת הברית של בננו!

📅 {{weekday}}, {{event_date}}
🕒 קבלת פנים בשעה {{event_time}}
📍 {{venue_name}}, {{venue_address}}

ניווט ב-Waze:
{{waze_url}}

לאישור הגעה:
{{invitation_url}}

נתראה,
{{hosts}}`),
  b('nudge', 'invite', 'עוד לא ענו: בדיקה עדינה', `היי {{guest_name}} 😊

רצינו לבדוק אם יצא לכם לראות את ההזמנה למסיבת הברית שלנו.

נשמח לדעת אם נזכה לראות אתכם, כדי שנוכל להיערך.

זה לוקח חצי דקה:
{{invitation_url}}

תודה ❤️
{{hosts}}`),
  b('last-call', 'invite', 'עוד לא ענו: תזכורת אחרונה', `היי {{guest_name}},

אנחנו סוגרים בימים הקרובים את רשימת המוזמנים למסיבת הברית ({{event_date}}, קבלת פנים בשעה {{event_time}}).

נשמח לתשובה קצרה, גם אם לא תוכלו להגיע:
{{invitation_url}}

תודה רבה,
{{hosts}}`),
  b('update', 'invite', 'עדכון לפני האירוע', `היי {{guest_name}},

עדכון קצר לקראת מסיבת הברית:

📅 {{weekday}}, {{event_date}}
🕒 קבלת פנים בשעה {{event_time}}
📍 {{venue_name}}, {{venue_address}}

כל הפרטים המעודכנים נמצאים תמיד בהזמנה:
{{invitation_url}}

{{hosts}}`),
  b('tomorrow-emoji', 'reminder', 'מחר נפגשים 🥳', `היי {{guest_name}}!

מחר נפגשים וחוגגים 🥳

📅 {{weekday}}, {{event_date}}
🕒 קבלת פנים בשעה {{event_time}}
📍 {{venue_name}}

ניווט:
{{waze_url}}

מחכים לראותכם ❤️
{{hosts}}`),
  b('today-emoji', 'reminder', 'היום, בעוד כמה שעות', `היי {{guest_name}} ❤️

מחכים לראות אתכם היום!

קבלת פנים בשעה {{event_time}}, ב-{{venue_name}}.

Waze:
{{waze_url}}

Google Maps:
{{maps_url}}

נתראה ממש בקרוב 😊`),
  b('directions', 'reminder', 'איך מגיעים', `היי {{guest_name}},

כדי שיהיה קל להגיע אלינו היום:

📍 {{venue_name}}, {{venue_address}}
🕒 קבלת פנים בשעה {{event_time}}

Waze:
{{waze_url}}

Google Maps:
{{maps_url}}

נתראה 😊`),
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

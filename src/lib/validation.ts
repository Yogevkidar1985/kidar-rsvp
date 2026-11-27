import { z } from 'zod';
import { normPhone } from './phone';

const count = z.coerce.number().int().min(0).max(50);
export const rsvpSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{2,60}$/),
  token: z.string().regex(/^[a-f0-9]{18}$/).nullish(),
  name: z.string().trim().min(2, 'נא למלא שם מלא').max(80),
  phone: z.string().trim().refine((p) => normPhone(p) !== null, 'מספר הטלפון אינו תקין'),
  status: z.enum(['attending', 'maybe', 'declined']),
  adults: count, children: count, babies: count,
  notes: z.string().max(500).optional().default(''),
  preferences: z.string().max(500).optional().default(''),
}).superRefine((v, ctx) => {
  if (v.status === 'attending' && v.adults + v.children < 1) {
    ctx.addIssue({ code: 'custom', path: ['adults'], message: 'נא לציין כמה מגיעים' });
  }
});
export type RsvpInput = z.infer<typeof rsvpSchema>;

export const RSVP_ERRORS: Record<string, string> = {
  RATE_LIMITED: 'נשלחו יותר מדי בקשות. נסו שוב בעוד כמה דקות.',
  NOT_FOUND: 'ההזמנה אינה זמינה.',
  RSVP_CLOSED: 'אישורי ההגעה לאירוע נסגרו. לשינויים פנו לבעלי האירוע.',
  INVALID_STATUS: 'נא לבחור אם אתם מגיעים.',
  INVALID_NAME: 'נא למלא שם מלא.',
  INVALID_PHONE: 'מספר הטלפון אינו תקין.',
  INVALID_COUNT: 'מספר המשתתפים אינו תקין.',
  TEXT_TOO_LONG: 'הטקסט ארוך מדי (עד 500 תווים).',
  INVALID_LINK: 'הקישור האישי אינו תקף. בקשו קישור חדש מבעלי האירוע.',
  PHONE_IN_USE: 'מספר הטלפון כבר רשום באישור אחר. השתמשו בטלפון אחר או פנו לבעלי האירוע.',
  OVER_ALLOCATION: 'מספר המשתתפים גדול ממספר המקומות שהוקצו לכם.',
  OVER_MAX: 'מספר המשתתפים גדול מהמותר באישור אחד. פנו לבעלי האירוע.',
};

export function safeHttpUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const url = new URL(u.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch { return null; }
}

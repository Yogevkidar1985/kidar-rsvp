import type { GuestStatus } from './types';
import { STATUS_LABEL } from './types';

export type NotifyKind = 'rsvp_new' | 'rsvp_update' | 'status_change' | 'count_change' | 'arrived' | 'test';
export type GuestSnapshot = {
  family_name: string; contact_name?: string | null; phone?: string | null; status: GuestStatus;
  adults: number; children: number; babies: number; notes?: string | null; preferences?: string | null;
  arrived?: boolean; arrived_count?: number | null;
};
export type Totals = { attendingPeople: number; attendingFamilies: number };

const TITLES: Record<NotifyKind, string> = {
  rsvp_new: 'אישור הגעה חדש', rsvp_update: 'עדכון אישור הגעה', status_change: 'שינוי סטטוס',
  count_change: 'שינוי בכמות המשתתפים', arrived: 'הגיעו לאירוע', test: 'הודעת בדיקה',
};
const ICON: Record<GuestStatus, string> = { attending: '✅', maybe: '🤔', declined: '❌', pending: '⏳' };

export function buildMessage(kind: NotifyKind, eventName: string, g: GuestSnapshot | null,
  prev: Partial<GuestSnapshot> | null, totals: Totals | null): string {
  if (kind === 'test' || !g) return `🔔 ${eventName}\nהודעת בדיקה: ההתראות פועלות.`;
  const lines = [`${kind === 'arrived' ? '🎉' : ICON[g.status]} ${TITLES[kind]} · ${eventName}`, ''];
  lines.push(`שם האורח: ${g.family_name}${g.contact_name && g.contact_name !== g.family_name ? ` (${g.contact_name})` : ''}`);
  if (g.phone) lines.push(`טלפון: ${g.phone}`);
  if (kind === 'arrived') {
    lines.push(`הגיעו בפועל: ${g.arrived_count ?? g.adults + g.children + g.babies}`);
  } else {
    lines.push(`סטטוס: ${STATUS_LABEL[g.status]}${prev?.status && prev.status !== g.status ? ` (קודם: ${STATUS_LABEL[prev.status]})` : ''}`);
    if (g.status !== 'declined') {
      lines.push(`מבוגרים ${g.adults} | ילדים ${g.children} | תינוקות ${g.babies}`);
      if (prev && prev.adults !== undefined && (prev.adults !== g.adults || prev.children !== g.children || prev.babies !== g.babies)) {
        lines.push(`קודם: מבוגרים ${prev.adults} | ילדים ${prev.children} | תינוקות ${prev.babies}`);
      }
    }
    if (g.preferences) lines.push(`העדפות: ${g.preferences}`);
    if (g.notes) lines.push(`הערות: ${g.notes}`);
  }
  const one = (n: number, single: string, many: string) => (n === 1 ? single : `${n} ${many}`);
  if (totals) lines.push('', `סה״כ מגיעים עד כה: ${one(totals.attendingPeople, 'אדם אחד', 'אנשים')}, ${one(totals.attendingFamilies, 'אישור אחד', 'אישורים')}`);
  return lines.join('\n');
}

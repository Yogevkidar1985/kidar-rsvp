import type { Guest, TableRow } from './types';
import { STATUS_LABEL } from './types';
import { seats, tableLoad } from './stats';

export type ColumnKey = 'family_name' | 'contact_name' | 'phone' | 'allocated_seats' | 'adults' | 'children' | 'babies'
  | 'total' | 'status' | 'responded_at' | 'table' | 'group_name' | 'is_vip' | 'arrived' | 'preferences' | 'notes' | 'admin_notes'
  | 'invited_at' | 'reminders_enabled' | 'opted_out' | 'link';
export const COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: 'family_name', label: 'שם משפחה' }, { key: 'contact_name', label: 'איש קשר' }, { key: 'phone', label: 'טלפון' },
  { key: 'allocated_seats', label: 'מקומות שהוקצו' }, { key: 'adults', label: 'מבוגרים' }, { key: 'children', label: 'ילדים' },
  { key: 'babies', label: 'תינוקות' }, { key: 'total', label: 'סה״כ משתתפים' }, { key: 'status', label: 'סטטוס' },
  { key: 'responded_at', label: 'תאריך אישור' }, { key: 'table', label: 'שולחן' }, { key: 'group_name', label: 'קבוצה' },
  { key: 'is_vip', label: 'VIP' }, { key: 'arrived', label: 'הגיעו בפועל' }, { key: 'preferences', label: 'העדפות מיוחדות' },
  { key: 'notes', label: 'הערות האורח' }, { key: 'admin_notes', label: 'הערות פנימיות' },
  { key: 'invited_at', label: 'הזמנה נשלחה' }, { key: 'reminders_enabled', label: 'תזכורות' }, { key: 'opted_out', label: 'ביקשו לא לקבל הודעות' }, { key: 'link', label: 'קישור אישי' },
];
export type Scope = 'all' | 'attending' | 'maybe' | 'pending' | 'declined';
export const SCOPES: { key: Scope; label: string }[] = [
  { key: 'all', label: 'כל המוזמנים' }, { key: 'attending', label: 'מי שאישרו' }, { key: 'maybe', label: 'אולי מגיעים' },
  { key: 'pending', label: 'מי שטרם השיבו' }, { key: 'declined', label: 'מי שלא מגיעים' },
];

const fmtDate = (iso: string | null) => iso
  ? new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Jerusalem' }).format(new Date(iso)) : '';

export function guestRows(guests: Guest[], tables: TableRow[], scope: Scope, cols: ColumnKey[], linkOf: (g: Guest) => string = () => ''): (string | number)[][] {
  const tname = new Map(tables.map((t) => [t.id, t.name]));
  const cell = (g: Guest, k: ColumnKey): string | number => {
    switch (k) {
      case 'total': return g.adults + g.children + g.babies;
      case 'status': return STATUS_LABEL[g.status];
      case 'responded_at': return fmtDate(g.responded_at);
      case 'invited_at': return fmtDate(g.invited_at ?? null);
      case 'reminders_enabled': return g.reminders_enabled === false ? 'כבויות' : 'פעילות';
      case 'opted_out': return g.opted_out ? 'כן' : '';
      case 'link': return linkOf(g);
      case 'table': return g.table_id ? tname.get(g.table_id) ?? '' : '';
      case 'is_vip': return g.is_vip ? 'כן' : '';
      case 'arrived': return g.arrived ? (g.arrived_count ?? g.adults + g.children + g.babies) : '';
      case 'allocated_seats': return g.allocated_seats ?? '';
      case 'adults': case 'children': case 'babies': return g[k];
      default: return g[k] ?? '';
    }
  };
  const header = cols.map((c) => COLUMNS.find((x) => x.key === c)!.label);
  const body = guests.filter((g) => scope === 'all' || g.status === scope)
    .sort((a, b) => a.family_name.localeCompare(b.family_name, 'he')).map((g) => cols.map((c) => cell(g, c)));
  return [header, ...body];
}

export function seatingRows(guests: Guest[], tables: TableRow[]): (string | number)[][] {
  const rows: (string | number)[][] = [['שולחן', 'קיבולת', 'תפוסים', 'פנויים', 'משפחה', 'איש קשר', 'טלפון', 'מקומות', 'סטטוס']];
  for (const t of [...tables].sort((a, b) => a.name.localeCompare(b.name, 'he', { numeric: true }))) {
    const l = tableLoad(t, guests);
    if (!l.guests.length) rows.push([t.name, t.capacity, 0, t.capacity, '', '', '', '', '']);
    for (const g of l.guests) rows.push([t.name, t.capacity, l.used, l.free, g.family_name, g.contact_name ?? '', g.phone ?? '', seats(g), STATUS_LABEL[g.status]]);
  }
  for (const g of guests.filter((x) => !x.table_id && x.status !== 'declined')) {
    rows.push(['ללא שולחן', '', '', '', g.family_name, g.contact_name ?? '', g.phone ?? '', seats(g), STATUS_LABEL[g.status]]);
  }
  return rows;
}

/** Excel treats a leading = + - @ as a formula. Prefix text cells so exported guest input stays inert. */
export const inert = (v: string | number) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

export function toCsv(rows: (string | number)[][]): string {
  return '﻿' + rows.map((r) => r.map((v) => `"${String(inert(v)).replace(/"/g, '""')}"`).join(',')).join('\r\n');
}

export async function toXlsx(sheets: { name: string; rows: (string | number)[][] }[]): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
    s.rows.forEach((r) => ws.addRow(r.map(inert)));
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E2A44' } };
    ws.columns.forEach((c, i) => {
      const len = Math.max(...s.rows.map((r) => String(r[i] ?? '').length), 6);
      c.width = Math.min(len + 4, 42);
    });
    if (s.rows.length > 1) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.rows[0].length } };
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

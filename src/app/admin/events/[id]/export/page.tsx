'use client';
import { useMemo, useState } from 'react';
import { useEvent } from '@/components/admin/EventContext';
import { PageHead } from '@/components/admin/Shell';
import { COLUMNS, SCOPES, download, guestRows, seatingRows, toCsv, toXlsx, type ColumnKey, type Scope } from '@/lib/export';

const DEFAULT: ColumnKey[] = ['family_name', 'contact_name', 'phone', 'allocated_seats', 'adults', 'children', 'babies', 'total', 'status', 'responded_at', 'table', 'notes'];

export default function ExportPage() {
  const { event, guests, tables } = useEvent();
  const [what, setWhat] = useState<'guests' | 'seating'>('guests');
  const [scope, setScope] = useState<Scope>('all');
  const [cols, setCols] = useState<ColumnKey[]>(DEFAULT);
  const rows = useMemo(() => what === 'guests'
    ? guestRows(guests, tables, scope, COLUMNS.map((c) => c.key).filter((k) => cols.includes(k)))
    : seatingRows(guests, tables), [what, guests, tables, scope, cols]);
  const title = what === 'guests' ? SCOPES.find((s) => s.key === scope)!.label : 'סידור שולחנות';
  const file = `${event.slug}-${what === 'guests' ? scope : 'seating'}`;
  const empty = rows.length < 2 || (what === 'guests' && !cols.length);

  return (
    <>
      <PageHead title="ייצוא" sub="הקובץ נבנה מהנתונים העדכניים ברגע הלחיצה." />
      <div className="no-print card grid gap-4 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <label><span className="label">מה לייצא</span>
            <select className="field" value={what} onChange={(e) => setWhat(e.target.value as 'guests' | 'seating')}><option value="guests">רשימת מוזמנים</option><option value="seating">סידור שולחנות</option></select></label>
          {what === 'guests' && <label><span className="label">אילו משפחות</span>
            <select className="field" value={scope} onChange={(e) => setScope(e.target.value as Scope)}>{SCOPES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>}
        </div>
        {what === 'guests' && (
          <fieldset><legend className="label">עמודות</legend>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3 lg:grid-cols-4">
              {COLUMNS.map((c) => <label key={c.key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cols.includes(c.key)} onChange={(e) => setCols((l) => e.target.checked ? [...l, c.key] : l.filter((k) => k !== c.key))} />{c.label}</label>)}
            </div></fieldset>
        )}
        <div className="flex flex-wrap gap-2">
          <button className="btn" disabled={empty} onClick={async () => download(await toXlsx([{ name: title.slice(0, 28), rows }]), `${file}.xlsx`)}>הורדת Excel</button>
          <button className="btn btn-ghost" disabled={empty} onClick={() => download(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }), `${file}.csv`)}>הורדת CSV</button>
          <button className="btn btn-ghost" disabled={empty} onClick={() => window.print()}>הדפסה / שמירה כ-PDF</button>
        </div>
        <p className="text-xs text-muted">קובץ ה-CSV נפתח ישירות ב-Google Sheets (קובץ ← ייבוא). לסנכרון אוטומטי אפשר לחבר Webhook במסך "התראות וחיבורים".</p>
      </div>

      <section className="print-area card mt-4 overflow-x-auto p-4">
        <h2 className="mb-3 font-display text-lg font-medium">{event.name} · {title} <span className="text-sm text-muted">({Math.max(rows.length - 1, 0)} שורות)</span></h2>
        {empty ? <p className="text-sm text-muted">אין נתונים לייצוא בבחירה הזו.</p> : (
          <table className="w-full text-sm" data-testid="export-preview">
            <thead><tr>{rows[0].map((h, i) => <th key={i} className="border-b border-line px-2 py-1.5 text-start font-semibold">{h}</th>)}</tr></thead>
            <tbody>{rows.slice(1).map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className="border-b border-line/60 px-2 py-1.5">{v}</td>)}</tr>)}</tbody>
          </table>
        )}
      </section>
    </>
  );
}

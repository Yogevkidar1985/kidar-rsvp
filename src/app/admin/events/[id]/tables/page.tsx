'use client';
import { useMemo, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useEvent } from '@/components/admin/EventContext';
import { PageHead } from '@/components/admin/Shell';
import { Empty, Field, Modal, StatusPill, dbError, useToast } from '@/components/admin/ui';
import { seats, tableLoad } from '@/lib/stats';
import { download, seatingRows, toXlsx } from '@/lib/export';
import type { TableRow } from '@/lib/types';

export default function TablesPage() {
  const { event, guests, tables, canEdit, reload, updateGuest } = useEvent();
  const toast = useToast();
  const db = supabaseBrowser();
  const [sel, setSel] = useState<string | null>(null);
  const [form, setForm] = useState<{ id: string | null; name: string; capacity: number; shape: 'round' | 'rect' } | null>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const hall = useRef<HTMLDivElement>(null);
  const moved = useRef(false);

  const loads = useMemo(() => new Map(tables.map((t) => [t.id, tableLoad(t, guests)])), [tables, guests]);
  const unseated = guests.filter((g) => !g.table_id && g.status !== 'declined');
  const current = tables.find((t) => t.id === sel) ?? null;
  const totalCap = tables.reduce((n, t) => n + t.capacity, 0);
  const totalUsed = [...loads.values()].reduce((n, l) => n + l.used, 0);

  async function saveTable(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const row = { name: form.name.trim(), capacity: form.capacity, shape: form.shape };
    const { error } = form.id
      ? await db.from('tables').update(row).eq('id', form.id)
      : await db.from('tables').insert({ ...row, event_id: event.id, pos_x: 12 + ((tables.length * 19) % 76), pos_y: 16 + ((Math.floor(tables.length / 4) * 24) % 70) });
    if (error) return toast(error.message.includes('TABLE_FULL') ? 'יושבים בשולחן יותר אנשים מהקיבולת החדשה. העבירו משפחות לפני ההקטנה.' : dbError(error), true);
    toast(form.id ? 'השולחן עודכן' : 'השולחן נוסף'); setForm(null); await reload();
  }
  async function removeTable(t: TableRow) {
    const { error } = await db.from('tables').delete().eq('id', t.id);
    if (error) return toast(dbError(error), true);
    toast('השולחן נמחק. המשפחות שישבו בו חזרו לרשימת הממתינים.'); setSel(null); await reload();
  }
  const assign = async (gid: string, tid: string | null) => { if (await updateGuest(gid, { table_id: tid })) toast(tid ? 'המשפחה שובצה' : 'המשפחה הוסרה מהשולחן'); };

  function onMove(e: React.PointerEvent) {
    if (!drag || !hall.current) return;
    const r = hall.current.getBoundingClientRect();
    moved.current = true;
    setDrag({ id: drag.id, x: Math.min(95, Math.max(5, ((e.clientX - r.left) / r.width) * 100)), y: Math.min(93, Math.max(7, ((e.clientY - r.top) / r.height) * 100)) });
  }
  async function onUp() {
    if (!drag) return;
    const d = drag; setDrag(null);
    if (!moved.current) return;
    const { error } = await db.from('tables').update({ pos_x: d.x, pos_y: d.y }).eq('id', d.id);
    if (error) toast(dbError(error), true);
    await reload();
  }
  async function exportXlsx() {
    download(await toXlsx([{ name: 'סידור שולחנות', rows: seatingRows(guests, tables) }]), `seating-${event.slug}.xlsx`);
  }

  return (
    <>
      <PageHead title="שולחנות" sub={`${totalUsed} מתוך ${totalCap} מקומות תפוסים · ${unseated.length} משפחות ממתינות לשיבוץ`}>
        <button className="btn btn-ghost" onClick={exportXlsx} disabled={!tables.length}>ייצוא ל-Excel</button>
        {canEdit && <button className="btn" onClick={() => setForm({ id: null, name: `שולחן ${tables.length + 1}`, capacity: 10, shape: 'round' })}>שולחן חדש</button>}
      </PageHead>

      {!tables.length ? <Empty title="עדיין אין שולחנות">צרו שולחן ראשון, קבעו כמה מקומות יש בו ושבצו אליו משפחות. המערכת לא תאפשר לחרוג מהקיבולת.</Empty> : (
        <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
          <section className="card p-3">
            <div ref={hall} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
              className="relative aspect-[4/3] w-full touch-none select-none overflow-hidden rounded-xl bg-[repeating-linear-gradient(0deg,#f3f5f8_0_1px,transparent_1px_40px),repeating-linear-gradient(90deg,#f3f5f8_0_1px,transparent_1px_40px)]" aria-label="תרשים האולם">
              {tables.map((t) => {
                const l = loads.get(t.id)!;
                const p = drag?.id === t.id ? drag : { x: Number(t.pos_x), y: Number(t.pos_y) };
                const fill = Math.min(1, l.used / t.capacity);
                return (
                  <button key={t.id} type="button" data-testid="hall-table"
                    onPointerDown={(e) => { if (canEdit) { moved.current = false; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); setDrag({ id: t.id, x: p.x, y: p.y }); } }}
                    onClick={() => { if (!moved.current) setSel(t.id); }}
                    style={{ left: `${p.x}%`, top: `${p.y}%`, background: `conic-gradient(${l.over ? '#b4483f' : '#2f7d5b'} ${fill * 360}deg, #dfe4ec 0)` }}
                    className={`absolute grid size-[76px] -translate-x-1/2 -translate-y-1/2 place-items-center p-1 shadow-sm ${t.shape === 'round' ? 'rounded-full' : 'rounded-xl'} ${sel === t.id ? 'ring-2 ring-brass ring-offset-2' : ''}`}>
                    <span className={`grid size-full place-items-center bg-white text-center leading-tight ${t.shape === 'round' ? 'rounded-full' : 'rounded-lg'}`}>
                      <span><span className="block max-w-16 truncate text-xs font-bold">{t.name}</span><span className="text-[11px] text-muted">{l.used}/{t.capacity}</span></span>
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="px-1 pt-2 text-xs text-muted">גוררים שולחן כדי למקם אותו באולם. לחיצה על שולחן מציגה מי יושב בו.</p>
          </section>

          <div className="grid content-start gap-4">
            <section className="card p-4">
              {current ? (() => {
                const l = loads.get(current.id)!;
                return (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div><h2 className="font-display text-lg font-medium">{current.name}</h2>
                        <p className={`text-sm ${l.over ? 'font-bold text-no' : 'text-muted'}`}>{l.over ? `חריגה של ${-l.free} מקומות` : `${l.free} מקומות פנויים מתוך ${current.capacity}`}</p></div>
                      {canEdit && <div className="flex gap-1">
                        <button className="btn btn-ghost btn-sm" onClick={() => setForm({ id: current.id, name: current.name, capacity: current.capacity, shape: current.shape })}>עריכה</button>
                        <button className="btn btn-danger btn-sm" onClick={() => removeTable(current)}>מחיקה</button></div>}
                    </div>
                    <ul className="mt-3 divide-y divide-line text-sm">
                      {l.guests.map((g) => (
                        <li key={g.id} className="flex flex-wrap items-center gap-2 py-2">
                          <b>{g.family_name}</b><StatusPill status={g.status} /><span className="text-muted">{seats(g)} מקומות</span>
                          {canEdit && <select className="field ms-auto !min-h-8 !w-auto !py-0 text-sm" aria-label={`העברת ${g.family_name}`} value={current.id} onChange={(e) => assign(g.id, e.target.value || null)}>
                            {tables.map((t) => <option key={t.id} value={t.id} disabled={t.id !== current.id && loads.get(t.id)!.free < seats(g)}>{t.name} ({loads.get(t.id)!.free} פנויים)</option>)}
                            <option value="">הסרה מהשולחן</option></select>}
                        </li>
                      ))}
                      {!l.guests.length && <li className="py-2 text-muted">אף אחד עדיין לא שובץ לשולחן הזה.</li>}
                    </ul>
                  </>
                );
              })() : <p className="text-sm text-muted">בחרו שולחן בתרשים כדי לראות מי יושב בו.</p>}
            </section>

            <section className="card p-4">
              <h2 className="font-display text-lg font-medium">ממתינים לשיבוץ</h2>
              <ul className="mt-2 max-h-[420px] divide-y divide-line overflow-y-auto text-sm">
                {unseated.map((g) => (
                  <li key={g.id} className="flex flex-wrap items-center gap-2 py-2">
                    <b>{g.family_name}</b><StatusPill status={g.status} /><span className="text-muted">{seats(g)} מקומות</span>
                    {canEdit && <select className="field ms-auto !min-h-8 !w-auto !py-0 text-sm" aria-label={`שיבוץ ${g.family_name}`} value="" onChange={(e) => e.target.value && assign(g.id, e.target.value)}>
                      <option value="">שיבוץ לשולחן</option>
                      {tables.map((t) => <option key={t.id} value={t.id} disabled={loads.get(t.id)!.free < seats(g)}>{t.name} ({loads.get(t.id)!.free} פנויים)</option>)}</select>}
                  </li>
                ))}
                {!unseated.length && <li className="py-2 text-muted">כל המשפחות שובצו.</li>}
              </ul>
            </section>
          </div>
        </div>
      )}

      {form && (
        <Modal title={form.id ? 'עריכת שולחן' : 'שולחן חדש'} onClose={() => setForm(null)}>
          <form onSubmit={saveTable} className="grid gap-3">
            <Field label="שם השולחן"><input className="field" required maxLength={40} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="מספר מקומות"><input className="field" type="number" min={1} max={200} required value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} /></Field>
            <Field label="צורה"><select className="field" value={form.shape} onChange={(e) => setForm({ ...form, shape: e.target.value as 'round' | 'rect' })}><option value="round">עגול</option><option value="rect">מלבני</option></select></Field>
            <div className="flex gap-2"><button className="btn">{form.id ? 'שמירת השולחן' : 'הוספת השולחן'}</button><button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>ביטול</button></div>
          </form>
        </Modal>
      )}
    </>
  );
}

'use client';
import { useMemo, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useEvent } from '@/components/admin/EventContext';
import { PageHead } from '@/components/admin/Shell';
import { Empty, Field, Modal, StatusPill, dbError, useToast } from '@/components/admin/ui';
import { seats, tableLoad } from '@/lib/stats';
import { download, seatingRows, toXlsx } from '@/lib/export';
import { STATUS_LABEL, type Guest, type GuestStatus, type TableRow } from '@/lib/types';

type Shape = 'round' | 'rect';
type Tone = 'empty' | 'part' | 'near' | 'full' | 'over';
const TONE_LABEL: Record<Tone, string> = { empty: 'ריק', part: 'יש מקום', near: 'כמעט מלא', full: 'מלא', over: 'חריגה' };
const toneOf = (used: number, cap: number): Tone => (used > cap ? 'over' : used === cap ? 'full' : used === 0 ? 'empty' : used / cap >= 0.8 ? 'near' : 'part');
/** A table's number, read out of its name: "שולחן 12" is 12. */
const numOf = (name: string) => { const m = /(\d+)\s*$/.exec(name); return m ? Number(m[1]) : null; };
const byNumber = (a: TableRow, b: TableRow) => a.name.localeCompare(b.name, 'he', { numeric: true });
/** Where table i of n sits in a grid of `cols` columns, in percent of the hall. Right to left, like the page. */
const gridSpot = (i: number, n: number, cols: number) => {
  const rows = Math.max(1, Math.ceil(n / cols));
  return { x: 100 - ((i % cols) + 0.5) * (100 / cols), y: (Math.floor(i / cols) + 0.5) * (100 / rows) };
};

/** One table as it is drawn on the plan: the top, a chair for every seat, filled for every seat that is taken. */
function TableArt({ shape, capacity, confirmed, tentative, label, tone }: { shape: Shape; capacity: number; confirmed: number; tentative: number; label: string; tone: Tone }) {
  const n = Math.min(capacity, 16);                     // more than 16 chairs would be dust: the number tells the rest
  const k = n / capacity;
  const solid = Math.round(Math.min(confirmed, capacity) * k), soft = Math.round(Math.min(confirmed + tentative, capacity) * k);
  const chairs = Array.from({ length: n }, (_, i) => {
    if (shape === 'round') { const a = (i / n) * Math.PI * 2 - Math.PI / 2; return [50 + Math.cos(a) * 43, 50 + Math.sin(a) * 43]; }
    const half = Math.ceil(n / 2), top = i < half, j = top ? i : i - half, m = top ? half : n - half;
    return [14 + ((j + 0.5) * 72) / Math.max(1, m), top ? 12 : 88];
  });
  return (
    <svg viewBox="0 0 100 100" className={`tbl-art tone-${tone}`} aria-hidden="true">
      {chairs.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={shape === 'round' ? 5.4 : 5} className={i < solid ? 'chair on' : i < soft ? 'chair maybe' : 'chair'} />)}
      {shape === 'round' ? <circle cx="50" cy="50" r="33" className="top" /> : <rect x="12" y="23" width="76" height="54" rx="9" className="top" />}
      <text x="50" y="47" textAnchor="middle" className="num">{label}</text>
      <text x="50" y="64" textAnchor="middle" className="cnt">{confirmed + tentative}/{capacity}</text>
    </svg>
  );
}

export default function TablesPage() {
  const { event, guests, tables, canEdit, reload, updateGuest } = useEvent();
  const toast = useToast();
  const db = supabaseBrowser();
  const [sel, setSel] = useState<string | null>(null);
  const [form, setForm] = useState<{ id: string | null; name: string; capacity: number; shape: Shape } | null>(null);
  const [wizard, setWizard] = useState<{ count: number; capacity: number; start: number; shape: Shape; cols: number } | null>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [view, setView] = useState<'plan' | 'list'>('plan');
  const [zoom, setZoom] = useState(1);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [fStatus, setFStatus] = useState<GuestStatus | ''>('');
  const [fGroup, setFGroup] = useState('');
  const [showSeated, setShowSeated] = useState(false);
  const [over, setOver] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ table: TableRow; list: Guest[]; need: number; free: number } | null>(null);
  const hall = useRef<HTMLDivElement>(null);
  const moved = useRef(false);

  const sorted = useMemo(() => [...tables].sort(byNumber), [tables]);
  const loads = useMemo(() => new Map(tables.map((t) => {
    const l = tableLoad(t, guests);
    const confirmed = l.guests.filter((g) => g.status === 'attending').reduce((n, g) => n + seats(g), 0);
    return [t.id, { ...l, confirmed, tentative: l.used - confirmed, tone: toneOf(l.used, t.capacity) }];
  })), [tables, guests]);
  const tname = useMemo(() => new Map(tables.map((t) => [t.id, t.name])), [tables]);
  const groups = useMemo(() => [...new Set(guests.map((g) => g.group_name).filter(Boolean))] as string[], [guests]);
  const waiting = guests.filter((g) => !g.table_id && g.status !== 'declined');
  const current = tables.find((t) => t.id === sel) ?? null;
  const totalCap = tables.reduce((n, t) => n + t.capacity, 0);
  const all = [...loads.values()];
  const seatedConfirmed = all.reduce((n, l) => n + l.confirmed, 0), seatedTentative = all.reduce((n, l) => n + l.tentative, 0);
  const waitingConfirmed = waiting.filter((g) => g.status === 'attending').reduce((n, g) => n + seats(g), 0);
  const stats = [
    { label: 'שולחנות', value: tables.length }, { label: 'מקומות בסך הכול', value: totalCap },
    { label: 'מאושרים שמשובצים', value: seatedConfirmed, tone: 'ok' }, { label: 'לא סופיים שמשובצים', value: seatedTentative, tone: 'warn' },
    { label: 'מקומות פנויים', value: Math.max(0, totalCap - seatedConfirmed - seatedTentative) },
    { label: 'מאושרים בלי שולחן', value: waitingConfirmed, tone: waitingConfirmed ? 'no' : '' },
    { label: 'שולחנות מלאים', value: all.filter((l) => l.tone === 'full').length }, { label: 'שולחנות בחריגה', value: all.filter((l) => l.over).length, tone: all.some((l) => l.over) ? 'no' : '' },
  ];

  // the list people are picked from
  const pool = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return guests.filter((g) => g.status !== 'declined' && (showSeated || !g.table_id)
      && (!needle || [g.family_name, g.contact_name, g.group_name, g.phone].some((v) => v?.toLowerCase().includes(needle)))
      && (!fStatus || g.status === fStatus) && (!fGroup || g.group_name === fGroup))
      .sort((a, b) => (a.group_name ?? '').localeCompare(b.group_name ?? '', 'he') || a.family_name.localeCompare(b.family_name, 'he'));
  }, [guests, q, fStatus, fGroup, showSeated]);
  const chosen = guests.filter((g) => picked.has(g.id));
  const need = chosen.reduce((n, g) => n + seats(g), 0);
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  /** Seats a group needs at a table, not counting those of them who already sit there. */
  const needAt = (list: Guest[], tid: string) => list.filter((g) => g.table_id !== tid).reduce((n, g) => n + seats(g), 0);

  async function saveTable(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const row = { name: form.name.trim(), capacity: form.capacity, shape: form.shape };
    const spot = gridSpot(tables.length, tables.length + 1, 5);
    const { error } = form.id ? await db.from('tables').update(row).eq('id', form.id) : await db.from('tables').insert({ ...row, event_id: event.id, pos_x: spot.x, pos_y: spot.y });
    if (error) return toast(error.message.includes('TABLE_FULL') ? 'יושבים בשולחן יותר אנשים מהקיבולת החדשה. העבירו משפחות לפני ההקטנה.' : dbError(error), true);
    toast(form.id ? 'השולחן עודכן' : 'השולחן נוסף'); setForm(null); await reload();
  }
  async function generate(e: React.FormEvent) {
    e.preventDefault();
    if (!wizard) return;
    setBusy(true);
    const total = tables.length + wizard.count;
    // the hall is laid out again as one grid, the tables that exist first: a new batch never lands on top of an old one
    const rows = Array.from({ length: wizard.count }, (_, i) => ({ event_id: event.id, name: `שולחן ${wizard.start + i}`, capacity: wizard.capacity, shape: wizard.shape, ...(({ x, y }) => ({ pos_x: x, pos_y: y }))(gridSpot(tables.length + i, total, wizard.cols)) }));
    const { error } = await db.from('tables').insert(rows);
    if (!error) await Promise.all(sorted.map((t, i) => { const s = gridSpot(i, total, wizard.cols); return db.from('tables').update({ pos_x: s.x, pos_y: s.y }).eq('id', t.id); }));
    setBusy(false);
    if (error) return toast(dbError(error), true);
    toast(`נוצרו ${wizard.count} שולחנות, ${wizard.count * wizard.capacity} מקומות`); setWizard(null); await reload();
  }
  async function tidy() {
    const cols = tables.length <= 6 ? 3 : tables.length <= 12 ? 4 : 5;
    await Promise.all(sorted.map((t, i) => { const s = gridSpot(i, tables.length, cols); return db.from('tables').update({ pos_x: s.x, pos_y: s.y }).eq('id', t.id); }));
    await reload(); toast('השולחנות סודרו בשורות לפי המספר');
  }
  async function removeTable(t: TableRow) {
    const l = loads.get(t.id)!;
    if (l.guests.length && !window.confirm(`בשולחן יושבות ${l.guests.length} משפחות (${l.used} מקומות). אם תמחקו אותו הן יחזרו לרשימת הממתינים. למחוק?`)) return;
    const { error } = await db.from('tables').delete().eq('id', t.id);
    if (error) return toast(dbError(error), true);
    toast(l.guests.length ? 'השולחן נמחק, והמשפחות חזרו לרשימת הממתינים' : 'השולחן נמחק'); setSel(null); await reload();
  }
  const assign = async (gid: string, tid: string | null) => { if (await updateGuest(gid, { table_id: tid })) toast(tid ? 'המשפחה שובצה' : 'המשפחה הוסרה מהשולחן'); };

  /** Seats several families at one table. The database refuses a seat too many; this checks first so the message is clear. */
  async function seatMany(list: Guest[], table: TableRow, grow = false) {
    const l = loads.get(table.id)!, needs = needAt(list, table.id);
    if (!list.length) return;
    if (needs > l.free && !grow) { setConfirm({ table, list, need: needs, free: l.free }); return; }
    setBusy(true);
    if (grow) {
      const { error } = await db.from('tables').update({ capacity: l.used + needs }).eq('id', table.id);
      if (error) { setBusy(false); return toast(dbError(error), true); }
    }
    let ok = 0; let failed = '';
    // one at a time: each family is checked against the seats really left at that moment
    for (const g of list) {
      if (g.table_id === table.id) { ok++; continue; }
      const { error } = await db.from('guests').update({ table_id: table.id }).eq('id', g.id);
      if (error) { failed = error.message.includes('TABLE_FULL') ? 'נגמר המקום בשולחן' : dbError(error); break; }
      ok++;
    }
    setBusy(false); setConfirm(null); await reload();
    if (failed) return toast(`שובצו ${ok} מתוך ${list.length}: ${failed}.`, true);
    setPicked(new Set()); setSel(table.id);
    toast(`${list.length === 1 ? list[0].family_name : `${list.length} משפחות`} שובצו ל${table.name}: ${l.used + needs}/${grow ? l.used + needs : table.capacity}`);
  }
  async function unseat(list: Guest[]) {
    setBusy(true);
    const { error } = await db.from('guests').update({ table_id: null }).in('id', list.map((g) => g.id)).eq('event_id', event.id);
    setBusy(false);
    if (error) return toast(dbError(error), true);
    setPicked(new Set()); await reload(); toast('הנבחרים הוסרו מהשולחנות');
  }

  function onMove(e: React.PointerEvent) {
    if (!drag || !hall.current) return;
    const r = hall.current.getBoundingClientRect();
    moved.current = true;
    setDrag({ id: drag.id, x: Math.min(92, Math.max(8, ((e.clientX - r.left) / r.width) * 100)), y: Math.min(92, Math.max(8, ((e.clientY - r.top) / r.height) * 100)) });
  }
  async function onUp() {
    if (!drag) return;
    const d = drag; setDrag(null);
    if (!moved.current) return;
    const { error } = await db.from('tables').update({ pos_x: d.x, pos_y: d.y }).eq('id', d.id);
    if (error) toast(dbError(error), true);
    await reload();
  }
  /** A tap on a table: with families chosen it seats them there, otherwise it opens the table. */
  const tapTable = (t: TableRow) => { if (moved.current) return; if (picked.size && canEdit) void seatMany(chosen, t); else setSel(t.id); };
  const dropOn = (t: TableRow, e: React.DragEvent) => {
    e.preventDefault(); setOver(null);
    const id = e.dataTransfer.getData('text/guest');
    const list = picked.has(id) ? chosen : guests.filter((g) => g.id === id);
    if (list.length) void seatMany(list, t);
  };
  async function exportXlsx() { download(await toXlsx([{ name: 'סידור שולחנות', rows: seatingRows(guests, tables) }]), `seating-${event.slug}.xlsx`); }
  const nextNumber = Math.max(0, ...tables.map((t) => numOf(t.name) ?? 0)) + 1;
  const openWizard = () => setWizard({ count: tables.length ? 5 : 15, capacity: 10, start: nextNumber, shape: 'round', cols: 5 });

  return (
    <>
      <PageHead title="סידור שולחנות" sub={tables.length ? `${seatedConfirmed + seatedTentative} מתוך ${totalCap} מקומות תפוסים · ${waiting.length} משפחות ממתינות לשיבוץ` : 'יוצרים שולחנות, בוחרים משפחות ומשבצים'}>
        {tables.length > 0 && <button className="btn btn-ghost no-print" onClick={() => window.print()}>הדפסה</button>}
        <button className="btn btn-ghost no-print" onClick={exportXlsx} disabled={!tables.length}>ייצוא ל-Excel</button>
        {canEdit && <button className="btn btn-ghost no-print" onClick={() => setForm({ id: null, name: `שולחן ${nextNumber}`, capacity: 10, shape: 'round' })}>שולחן בודד</button>}
        {canEdit && <button className="btn no-print" data-testid="open-wizard" onClick={openWizard}>יצירת שולחנות</button>}
      </PageHead>

      {!tables.length ? (
        <Empty title="עדיין אין שולחנות">
          יוצרים את כל השולחנות בבת אחת, למשל 15 שולחנות של 10 מקומות, ורואים אותם מיד על תרשים האולם. אחר כך בוחרים משפחות ומשבצים אותן.
          {canEdit && <div className="mt-3"><button className="btn" onClick={openWizard}>יצירת שולחנות</button></div>}
        </Empty>
      ) : (
        <>
          <div className="kpis mb-3" data-testid="seat-stats">{stats.map((s) => <div key={s.label} className={`kpi ${s.tone ?? ''}`}><b>{s.value}</b><span>{s.label}</span></div>)}</div>
          <div className="seat-grid">
            <section className="card seat-plan p-3" data-testid="plan">
              <div className="mb-2 flex flex-wrap items-center gap-2 no-print">
                <div className="tabs"><button aria-pressed={view === 'plan'} onClick={() => setView('plan')}>תרשים</button><button aria-pressed={view === 'list'} onClick={() => setView('list')}>רשימה</button></div>
                {view === 'plan' && <>
                  <div className="ms-auto flex items-center gap-1">
                    <button className="btn btn-ghost btn-sm btn-icon" aria-label="הקטנת התרשים" disabled={zoom <= 1} onClick={() => setZoom((z) => Math.max(1, +(z - 0.25).toFixed(2)))}>−</button>
                    <span className="w-10 text-center text-xs text-muted" dir="ltr">{Math.round(zoom * 100)}%</span>
                    <button className="btn btn-ghost btn-sm btn-icon" aria-label="הגדלת התרשים" disabled={zoom >= 2} onClick={() => setZoom((z) => Math.min(2, +(z + 0.25).toFixed(2)))}>+</button>
                  </div>
                  {canEdit && <button className="btn btn-ghost btn-sm" onClick={tidy}>סידור בשורות</button>}
                </>}
              </div>
              {picked.size > 0 && canEdit && <p className="notice mb-2 no-print" role="status">נבחרו {picked.size} משפחות, {need} מקומות. לחצו על שולחן כדי לשבץ אותן בו.</p>}
              {view === 'plan' ? (
                <div className="hall-scroll">
                  <div ref={hall} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} className="hall" style={{ width: `${zoom * 100}%` }} aria-label="תרשים האולם">
                    {sorted.map((t) => {
                      const l = loads.get(t.id)!;
                      const p = drag?.id === t.id ? drag : { x: Number(t.pos_x), y: Number(t.pos_y) };
                      const fits = picked.size ? needAt(chosen, t.id) <= l.free : true;
                      return (
                        <button key={t.id} type="button" data-testid="hall-table" data-tone={l.tone} data-name={t.name}
                          aria-label={`${t.name}: ${l.used} מתוך ${t.capacity} מקומות, ${TONE_LABEL[l.tone]}`}
                          onPointerDown={(e) => { if (canEdit && !picked.size) { moved.current = false; (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); setDrag({ id: t.id, x: p.x, y: p.y }); } }}
                          onClick={() => tapTable(t)}
                          onDragOver={(e) => { if (canEdit) { e.preventDefault(); setOver(t.id); } }} onDragLeave={() => setOver((o) => (o === t.id ? null : o))} onDrop={(e) => canEdit && dropOn(t, e)}
                          style={{ left: `${p.x}%`, top: `${p.y}%` }}
                          className={`hall-table ${sel === t.id ? 'is-sel' : ''} ${over === t.id ? 'is-over' : ''} ${picked.size ? (fits ? 'can-take' : 'no-room') : ''}`}>
                          <TableArt shape={t.shape} capacity={t.capacity} confirmed={l.confirmed} tentative={l.tentative} label={String(numOf(t.name) ?? t.name.slice(0, 4))} tone={l.tone} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <ul className="tbl-cards" data-testid="table-cards">
                  {sorted.map((t) => { const l = loads.get(t.id)!; return (
                    <li key={t.id}><button type="button" className={`tbl-card tone-${l.tone} ${sel === t.id ? 'is-sel' : ''}`} onClick={() => tapTable(t)}>
                      <b>{t.name}</b><span>{l.used}/{t.capacity}</span><i><em style={{ width: `${Math.min(100, (l.used / t.capacity) * 100)}%` }} /></i><small>{l.over ? `חריגה של ${-l.free}` : l.free ? `${l.free} פנויים` : 'מלא'}</small>
                    </button></li>); })}
                </ul>
              )}
              <div className="legend no-print" aria-hidden="true">{(['empty', 'part', 'near', 'full', 'over'] as Tone[]).map((x) => <span key={x} className={`tone-${x}`}><i />{TONE_LABEL[x]}</span>)}<span><i className="dot-maybe" />לא סופי</span></div>
            </section>

            <div className="grid content-start gap-3">
              <section className="card p-4" data-testid="table-panel">
                {current ? (() => {
                  const l = loads.get(current.id)!;
                  return (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h2 className="font-display text-lg font-medium">{current.name}</h2>
                          <p className={`text-sm ${l.over ? 'font-bold text-no' : 'text-muted'}`} data-testid="table-count">{l.used} / {current.capacity} מקומות · {l.over ? `חריגה של ${-l.free}` : l.free ? `${l.free} פנויים` : 'מלא'}</p>
                          <p className="text-xs text-muted">{l.guests.length} משפחות · {l.confirmed} מאושרים{l.tentative ? ` · ${l.tentative} לא סופיים` : ''}</p>
                        </div>
                        {canEdit && <div className="flex gap-1 no-print">
                          <button className="btn btn-ghost btn-sm" onClick={() => setForm({ id: current.id, name: current.name, capacity: current.capacity, shape: current.shape })}>עריכה</button>
                          <button className="btn btn-danger btn-sm" onClick={() => removeTable(current)}>מחיקה</button></div>}
                      </div>
                      <ul className="mt-3 divide-y divide-line text-sm" data-testid="table-guests">
                        {l.guests.map((g) => (
                          <li key={g.id} className="flex flex-wrap items-center gap-2 py-2">
                            <b>{g.family_name}</b><StatusPill status={g.status} /><span className="text-muted">{seats(g)} מקומות</span>
                            {canEdit && <select className="field ms-auto !min-h-9 !w-auto !py-0 text-sm no-print" aria-label={`העברת ${g.family_name}`} value={current.id} onChange={(e) => assign(g.id, e.target.value || null)}>
                              {sorted.map((t) => <option key={t.id} value={t.id} disabled={t.id !== current.id && loads.get(t.id)!.free < seats(g)}>{t.name} ({loads.get(t.id)!.free} פנויים)</option>)}
                              <option value="">הסרה מהשולחן</option></select>}
                          </li>
                        ))}
                        {!l.guests.length && <li className="py-2 text-muted">אף אחד עדיין לא שובץ לשולחן הזה. בחרו משפחות ברשימה ולחצו על השולחן.</li>}
                      </ul>
                    </>
                  );
                })() : <p className="text-sm text-muted">לחצו על שולחן בתרשים כדי לראות מי יושב בו.</p>}
              </section>

              <section className="card p-4 no-print" data-testid="assign-panel">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-display text-lg font-medium">בחירת משפחות לשיבוץ</h2>
                  <span className="text-sm text-muted">{waiting.length} ממתינות · {waiting.reduce((n, g) => n + seats(g), 0)} מקומות</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <input className="field col-span-2" type="search" placeholder="חיפוש שם, טלפון או קבוצה" aria-label="חיפוש משפחה" value={q} onChange={(e) => setQ(e.target.value)} />
                  <select className="field" aria-label="סטטוס" value={fStatus} onChange={(e) => setFStatus(e.target.value as GuestStatus | '')}><option value="">כל הסטטוסים</option>{(['attending', 'maybe', 'pending'] as GuestStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
                  <select className="field" aria-label="קבוצה" value={fGroup} onChange={(e) => setFGroup(e.target.value)}><option value="">כל הקבוצות</option>{groups.map((g) => <option key={g}>{g}</option>)}</select>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={showSeated} onChange={(e) => setShowSeated(e.target.checked)} />להציג גם משובצים</label>
                  <button type="button" className="font-medium underline" onClick={() => setPicked(pool.length && pool.every((g) => picked.has(g.id)) ? new Set() : new Set(pool.map((g) => g.id)))}>{pool.length && pool.every((g) => picked.has(g.id)) ? 'ביטול הבחירה' : `בחירת כל המוצגים (${pool.length})`}</button>
                </div>
                <ul className="pick-list mt-2" data-testid="pick-list">
                  {pool.map((g) => (
                    <li key={g.id} className={picked.has(g.id) ? 'is-on' : ''} draggable={canEdit} onDragStart={(e) => { e.dataTransfer.setData('text/guest', g.id); e.dataTransfer.effectAllowed = 'move'; }}>
                      <label>
                        <input type="checkbox" checked={picked.has(g.id)} disabled={!canEdit} onChange={() => toggle(g.id)} aria-label={`בחירת ${g.family_name}`} />
                        <span className="min-w-0 flex-1"><b className="block truncate">{g.family_name}</b>
                          <small>{STATUS_LABEL[g.status]}{g.group_name ? ` · ${g.group_name}` : ''}{g.table_id ? ` · ${tname.get(g.table_id)}` : ''}</small></span>
                        <span className="seats" title="מקומות ישיבה">{seats(g)}</span>
                      </label>
                    </li>
                  ))}
                  {!pool.length && <li className="empty">{waiting.length ? 'אין משפחות שמתאימות לסינון.' : 'כל המשפחות שובצו.'}</li>}
                </ul>
              </section>
            </div>
          </div>

          {picked.size > 0 && canEdit && (
            <div className="seat-bar no-print" data-testid="seat-bar" role="region" aria-label="שיבוץ הנבחרים">
              <div><b>{picked.size} משפחות · {need} מקומות</b><small>{chosen.filter((g) => g.status !== 'attending').length ? `מתוכן ${chosen.filter((g) => g.status !== 'attending').length} שעוד לא אישרו סופית` : 'כולן אישרו הגעה'}</small></div>
              <select className="field" aria-label="שיבוץ הנבחרים לשולחן" value="" disabled={busy} onChange={(e) => { const t = tables.find((x) => x.id === e.target.value); if (t) void seatMany(chosen, t); }}>
                <option value="">שיבוץ לשולחן…</option>
                {sorted.map((t) => { const l = loads.get(t.id)!, n = needAt(chosen, t.id); return <option key={t.id} value={t.id}>{t.name} · {l.free} פנויים{n > l.free ? ` (חסרים ${n - l.free})` : ''}</option>; })}
              </select>
              {chosen.some((g) => g.table_id) && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => unseat(chosen.filter((g) => g.table_id))}>הסרה מהשולחן</button>}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicked(new Set())}>ביטול</button>
            </div>
          )}
        </>
      )}

      {confirm && (
        <Modal title="אין מספיק מקום בשולחן" onClose={() => setConfirm(null)}>
          <div data-testid="no-room">
            <p>ניסיתם לשבץ <b>{confirm.need} מקומות</b> ל{confirm.table.name}, ויש בו רק <b>{confirm.free} פנויים</b>.</p>
            <p className="mt-2 text-sm text-muted">אפשר לבחור שולחן אחר, להוריד משפחות מהבחירה, או להגדיל את השולחן הזה בכוונה.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="btn btn-ghost" onClick={() => setConfirm(null)}>חזרה לבחירה</button>
              <button className="btn" disabled={busy} onClick={() => seatMany(confirm.list, confirm.table, true)}>להגדיל את השולחן ל-{loads.get(confirm.table.id)!.used + confirm.need} ולשבץ</button>
            </div>
          </div>
        </Modal>
      )}
      {wizard && (
        <Modal title="יצירת שולחנות" onClose={() => setWizard(null)} wide>
          <form onSubmit={generate} className="grid gap-4 md:grid-cols-[minmax(0,260px)_1fr]" data-testid="wizard">
            <div className="grid content-start gap-3">
              <Field label="כמה שולחנות"><input className="field" type="number" min={1} max={60} required value={wizard.count} onChange={(e) => setWizard({ ...wizard, count: Math.min(60, Math.max(1, Number(e.target.value) || 1)) })} /></Field>
              <Field label="מקומות בכל שולחן"><input className="field" type="number" min={1} max={200} required value={wizard.capacity} onChange={(e) => setWizard({ ...wizard, capacity: Math.min(200, Math.max(1, Number(e.target.value) || 1)) })} /></Field>
              <Field label="המספור מתחיל מ-"><input className="field" type="number" min={1} max={999} required value={wizard.start} onChange={(e) => setWizard({ ...wizard, start: Math.max(1, Number(e.target.value) || 1) })} /></Field>
              <Field label="צורה"><select className="field" value={wizard.shape} onChange={(e) => setWizard({ ...wizard, shape: e.target.value as Shape })}><option value="round">עגול</option><option value="rect">מלבני</option></select></Field>
              <Field label="שולחנות בשורה"><select className="field" value={wizard.cols} onChange={(e) => setWizard({ ...wizard, cols: Number(e.target.value) })}>{[3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
            </div>
            <div className="grid content-start gap-2">
              <p className="text-sm"><b data-testid="wizard-total">{wizard.count} שולחנות · {wizard.count * wizard.capacity} מקומות</b>{tables.length > 0 && <span className="text-muted"> · יחד עם הקיימים: {tables.length + wizard.count} שולחנות, {totalCap + wizard.count * wizard.capacity} מקומות</span>}</p>
              <div className="hall hall--preview" aria-label="תצוגה מקדימה של האולם">
                {Array.from({ length: tables.length + wizard.count }, (_, i) => { const s = gridSpot(i, tables.length + wizard.count, wizard.cols); const old = i < tables.length;
                  return <span key={i} className={`hall-table ${old ? 'is-old' : ''}`} style={{ left: `${s.x}%`, top: `${s.y}%` }}><TableArt shape={old ? sorted[i].shape : wizard.shape} capacity={old ? sorted[i].capacity : wizard.capacity} confirmed={0} tentative={0} label={String(old ? numOf(sorted[i].name) ?? '' : wizard.start + i - tables.length)} tone="empty" /></span>; })}
              </div>
              <p className="text-xs text-muted">אחרי היצירה אפשר לגרור כל שולחן למקום שלו באולם, לשנות קיבולת של שולחן בודד ולהוסיף עוד.</p>
              <div className="flex gap-2"><button className="btn" disabled={busy}>{busy ? 'יוצרים…' : `יצירת ${wizard.count} שולחנות`}</button><button type="button" className="btn btn-ghost" onClick={() => setWizard(null)}>ביטול</button></div>
            </div>
          </form>
        </Modal>
      )}
      {form && (
        <Modal title={form.id ? 'עריכת שולחן' : 'שולחן חדש'} onClose={() => setForm(null)}>
          <form onSubmit={saveTable} className="grid gap-3">
            <Field label="שם השולחן"><input className="field" required maxLength={40} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="מספר מקומות"><input className="field" type="number" min={1} max={200} required value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} /></Field>
            <Field label="צורה"><select className="field" value={form.shape} onChange={(e) => setForm({ ...form, shape: e.target.value as Shape })}><option value="round">עגול</option><option value="rect">מלבני</option></select></Field>
            <div className="flex gap-2"><button className="btn">{form.id ? 'שמירת השולחן' : 'הוספת השולחן'}</button><button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>ביטול</button></div>
          </form>
        </Modal>
      )}
    </>
  );
}

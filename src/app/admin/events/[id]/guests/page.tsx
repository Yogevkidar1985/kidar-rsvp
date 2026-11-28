'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useEvent } from '@/components/admin/EventContext';
import { PageHead } from '@/components/admin/Shell';
import { Empty, Field, Modal, StatusPill, dbError, fmtDateTime, useToast } from '@/components/admin/ui';
import { STATUS_LABEL, type Guest, type GuestStatus, type ResponseRow } from '@/lib/types';
import { intlPhone } from '@/lib/phone';
import { inviteUrl } from '@/lib/templates';
import { tableLoad } from '@/lib/stats';
import { DuplicatesPanel, useDuplicates } from '@/components/admin/Duplicates';
import { download, toCsv, toXlsx, guestRows, COLUMNS } from '@/lib/export';
import { versions } from '@/lib/versions';

type SortKey = 'family_name' | 'status' | 'responded_at' | 'total' | 'allocated_seats' | 'created_at';
type Quick = '' | 'dups' | 'nophone' | 'notable' | 'today' | 'people';
/** Date over time, the way a registration is read: 28/11/2026 and under it 01:14. Israel time. */
const stamp = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = new Date(iso), o = { timeZone: 'Asia/Jerusalem' } as const;
  return { date: new Intl.DateTimeFormat('he-IL', { ...o, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d).replace(/\./g, '/'), time: new Intl.DateTimeFormat('he-IL', { ...o, hour: '2-digit', minute: '2-digit', hour12: false }).format(d) };
};
const dayOf = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date(iso));
const STATUSES: GuestStatus[] = ['pending', 'attending', 'maybe', 'declined'];
const blank = { family_name: '', contact_name: '', phone: '', allocated_seats: '' as number | '', status: 'pending' as GuestStatus,
  adults: 0, children: 0, babies: 0, group_name: '', table_id: '', is_vip: false, admin_notes: '', notes: '', preferences: '', reminders_enabled: true, opted_out: false };
type Draft = typeof blank;

export default function GuestsPage() {
  const { event, guests, tables, canEdit, reload, updateGuest } = useEvent();
  const toast = useToast();
  const db = supabaseBrowser();
  const [q, setQ] = useState('');
  const [fStatus, setFStatus] = useState<GuestStatus | ''>('');
  const [fGroup, setFGroup] = useState('');
  const [fTable, setFTable] = useState('');
  const [vipOnly, setVipOnly] = useState(false);
  const [quick, setQuick] = useState<Quick>('');
  const [view, setView] = useState<'list' | 'dups'>('list');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<{ group: string; table: string }>({ group: '', table: '' });
  const dups = useDuplicates(event.id, guests);
  useEffect(() => { if (new URLSearchParams(window.location.search).get('view') === 'dups') setView('dups'); }, []);
  const today = dayOf(new Date().toISOString());
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'family_name', dir: 1 });
  const [edit, setEdit] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [del, setDel] = useState<Guest | null>(null);
  const [arrive, setArrive] = useState<{ g: Guest; n: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<ResponseRow[]>([]);
  const [visits, setVisits] = useState<{ id: number; kind: string; created_at: string }[]>([]);

  // the WhatsApp columns exist once supabase/migrations/0002_whatsapp.sql has run
  const hasWa = guests.length > 0 ? 'reminders_enabled' in guests[0] : false;
  const [log, setLog] = useState<{ id: number; status: string; sent_at: string | null; created_at: string; error: string | null; campaigns: { name: string; kind: string } | null }[]>([]);
  const groups = useMemo(() => [...new Set(guests.map((g) => g.group_name).filter(Boolean))] as string[], [guests]);
  const tname = useMemo(() => new Map(tables.map((t) => [t.id, t.name])), [tables]);
  const total = (g: Guest) => g.adults + g.children + g.babies;
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const digits = needle.replace(/\D/g, '');
    const list = guests.filter((g) =>
      (!needle || [g.family_name, g.contact_name, g.group_name].some((v) => v?.toLowerCase().includes(needle)) || (digits.length > 2 && (g.phone ?? '').replace(/\D/g, '').includes(digits)))
      && (!fStatus || g.status === fStatus) && (!fGroup || g.group_name === fGroup)
      && (!fTable || (fTable === 'none' ? !g.table_id : g.table_id === fTable)) && (!vipOnly || g.is_vip)
      && (quick === '' || quick === 'people' || (quick === 'dups' ? dups.ids.has(g.id) : quick === 'nophone' ? !g.phone : quick === 'notable' ? !g.table_id && g.status !== 'declined' : dayOf(g.created_at) === today)));
    const val = (g: Guest) => sort.key === 'total' ? total(g) : sort.key === 'status' ? STATUSES.indexOf(g.status) : sort.key === 'allocated_seats' ? g.allocated_seats ?? -1 : g[sort.key] ?? '';
    return list.sort((a, b) => {
      const x = val(a), y = val(b);
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'he')) * sort.dir;
    });
  }, [guests, q, fStatus, fGroup, fTable, vipOnly, sort, quick, dups.ids, today]);

  useEffect(() => {
    setHistory([]);
    if (!edit?.id) return;
    db.from('rsvp_responses').select('id,guest_id,status,adults,children,babies,arrived,source,created_at').eq('guest_id', edit.id)
      .order('created_at', { ascending: false }).limit(20).then(({ data }: { data: ResponseRow[] | null }) => setHistory(data ?? []));
    setLog([]); setVisits([]);
    db.from('invitation_events').select('id,kind,created_at').eq('guest_id', edit.id).order('created_at', { ascending: false }).limit(30)
      .then(({ data }: { data: { id: number; kind: string; created_at: string }[] | null }) => setVisits(data ?? []));
    db.from('messages').select('id,status,sent_at,created_at,error,campaigns(name,kind)').eq('guest_id', edit.id).order('id', { ascending: false }).limit(20)
      .then(({ data }: { data: typeof log | null }) => setLog(data ?? []));
  }, [db, edit?.id]);

  const link = (g: Guest) => inviteUrl(window.location.origin, event.slug, g);
  const copy = (g: Guest) => navigator.clipboard.writeText(link(g)).then(() => toast('הקישור האישי הועתק'), () => toast('לא הצלחנו להעתיק', true));
  const wa = (g: Guest) => {
    const p = g.phone && intlPhone(g.phone);
    return p ? `https://wa.me/${p}?text=${encodeURIComponent(`${g.family_name} היקרים, נשמח לראותכם!\nלפרטים ולאישור הגעה:\n${link(g)}`)}` : null;
  };
  const openEdit = (g?: Guest) => setEdit(g ? { id: g.id, draft: { family_name: g.family_name, contact_name: g.contact_name ?? '', phone: g.phone ?? '',
    allocated_seats: g.allocated_seats ?? '', status: g.status, adults: g.adults, children: g.children, babies: g.babies, group_name: g.group_name ?? '',
    table_id: g.table_id ?? '', is_vip: g.is_vip, admin_notes: g.admin_notes ?? '', notes: g.notes ?? '', preferences: g.preferences ?? '', reminders_enabled: g.reminders_enabled !== false, opted_out: !!g.opted_out } } : { id: null, draft: { ...blank } });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!edit) return;
    const d = edit.draft;
    const patch = {
      family_name: d.family_name.trim(), contact_name: d.contact_name.trim() || null, phone: d.phone.trim() || null,
      allocated_seats: d.allocated_seats === '' ? null : Number(d.allocated_seats), status: d.status,
      adults: Number(d.adults) || 0, children: Number(d.children) || 0, babies: Number(d.babies) || 0,
      group_name: d.group_name.trim() || null, table_id: d.table_id || null, is_vip: d.is_vip, admin_notes: d.admin_notes.trim() || null,
      notes: d.notes.trim() || null, preferences: d.preferences.trim() || null,
      ...(hasWa ? { reminders_enabled: d.reminders_enabled, opted_out: d.opted_out } : {}),
    };
    setBusy(true);
    let ok: boolean;
    if (edit.id) ok = await updateGuest(edit.id, patch);
    else {
      const { error } = await db.from('guests').insert({ ...patch, event_id: event.id });
      ok = !error;
      if (error) toast(dbError(error), true); else await reload();
    }
    setBusy(false);
    if (ok) { toast(edit.id ? 'השינויים נשמרו' : 'המשפחה נוספה'); setEdit(null); }
  }
  async function remove() {
    if (!del) return;
    // a full copy is kept before the family goes, so the deletion can be taken back
    const r = await versions.deleteGuest(event.id, del.id);
    if (!r.ok) toast(r.message ?? 'המחיקה נכשלה.', true); else { setGone({ id: del.id, name: del.family_name }); await reload(); }
    setDel(null);
  }
  const [gone, setGone] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => { if (!gone) return; const id = window.setTimeout(() => setGone(null), 20000); return () => window.clearTimeout(id); }, [gone]);
  async function bringBack() {
    if (!gone) return;
    const r = await versions.restoreGuest(event.id, gone.id);
    if (!r.ok) return toast(r.message ?? 'לא הצלחנו להחזיר.', true);
    toast(`${gone.name} חזרה לרשימה`); setGone(null); await reload();
  }
  const th = (key: SortKey, label: string) => (
    <th className="px-3 py-2.5 text-start font-semibold" aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="inline-flex items-center gap-1" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))}>
        {label}<span className="text-xs text-muted">{sort.key === key ? (sort.dir === 1 ? '▲' : '▼') : ''}</span>
      </button>
    </th>
  );
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setEdit((s) => s && { ...s, draft: { ...s.draft, [k]: v } });
  const current = edit?.id ? guests.find((g) => g.id === edit.id) ?? null : null;
  const clearFilters = () => { setQ(''); setFStatus(''); setFGroup(''); setFTable(''); setVipOnly(false); setQuick(''); };
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const chosen = guests.filter((g) => picked.has(g.id));
  const only = (status: GuestStatus | '', quickTo: Quick = '') => { setView('list'); setQ(''); setFGroup(''); setFTable(''); setVipOnly(false); setFStatus(status); setQuick(quickTo); };
  const people = guests.filter((g) => g.status === 'attending').reduce((n, g) => n + total(g), 0);
  const count = (s: GuestStatus) => guests.filter((g) => g.status === s).length;
  const kpis: { key: string; label: string; value: number; on: boolean; go: () => void; tone?: string }[] = [
    { key: 'all', label: 'משפחות ברשימה', value: guests.length, on: view === 'list' && !fStatus && !quick, go: () => only('') },
    { key: 'people', label: 'אנשים מגיעים', value: people, on: view === 'list' && fStatus === 'attending' && quick === 'people', go: () => only('attending', 'people'), tone: 'ok' },
    { key: 'attending', label: 'מגיעים', value: count('attending'), on: view === 'list' && fStatus === 'attending' && quick === '', go: () => only('attending'), tone: 'ok' },
    { key: 'maybe', label: 'לא בטוחים', value: count('maybe'), on: view === 'list' && fStatus === 'maybe', go: () => only('maybe'), tone: 'warn' },
    { key: 'declined', label: 'לא מגיעים', value: count('declined'), on: view === 'list' && fStatus === 'declined', go: () => only('declined'), tone: 'no' },
    { key: 'pending', label: 'טרם השיבו', value: count('pending'), on: view === 'list' && fStatus === 'pending', go: () => only('pending') },
    { key: 'today', label: 'נרשמו היום', value: guests.filter((g) => dayOf(g.created_at) === today).length, on: view === 'list' && quick === 'today', go: () => only('', 'today') },
    { key: 'dups', label: 'כפילויות לבדיקה', value: dups.groups.length, on: view === 'dups', go: () => setView('dups'), tone: dups.groups.length ? 'warn' : '' },
    { key: 'nophone', label: 'בלי טלפון', value: guests.filter((g) => !g.phone).length, on: view === 'list' && quick === 'nophone', go: () => only('', 'nophone') },
    { key: 'notable', label: 'בלי שולחן', value: guests.filter((g) => !g.table_id && g.status !== 'declined').length, on: view === 'list' && quick === 'notable', go: () => only('', 'notable') },
  ];
  async function bulkSet(patch: Partial<Guest>, done: string) {
    setBusy(true);
    const { error } = await db.from('guests').update(patch).in('id', [...picked]).eq('event_id', event.id);
    setBusy(false);
    if (error) return toast(dbError(error), true);
    await reload(); toast(done);
  }
  async function exportChosen(kind: 'xlsx' | 'csv' | 'vcf') {
    const file = `${event.slug}-selected-${chosen.length}`;
    if (kind === 'vcf') {
      const esc = (s: string) => s.replace(/([,;\\])/g, '\\$1');
      const cards = chosen.filter((g) => g.phone && intlPhone(g.phone)).map((g) => ['BEGIN:VCARD', 'VERSION:3.0', `FN:${esc(g.contact_name || g.family_name)}`, `N:${esc(g.family_name)};;;;`, `TEL;TYPE=CELL:+${intlPhone(g.phone!)}`, `NOTE:${esc(event.name)}`, 'END:VCARD'].join('\r\n'));
      if (!cards.length) return toast('לאף אחד מהנבחרים אין מספר טלפון תקין.', true);
      download(new Blob([cards.join('\r\n') + '\r\n'], { type: 'text/vcard;charset=utf-8' }), `${file}.vcf`);
      return toast(`נוצר קובץ עם ${cards.length} אנשי קשר`);
    }
    const cols = COLUMNS.map((c) => c.key).filter((k) => !['reminders_enabled', 'opted_out', 'arrived'].includes(k));
    const data = guestRows(chosen, tables, 'all', cols, link);
    if (kind === 'csv') download(new Blob([toCsv(data)], { type: 'text/csv;charset=utf-8' }), `${file}.csv`);
    else download(await toXlsx([{ name: 'נבחרים', rows: data }]), `${file}.xlsx`);
  }
  const copyPhones = () => {
    const list = chosen.map((g) => g.phone && intlPhone(g.phone)).filter(Boolean).map((p) => `+${p}`);
    if (!list.length) return toast('לאף אחד מהנבחרים אין מספר טלפון תקין.', true);
    navigator.clipboard.writeText(list.join('\n')).then(() => toast(`${list.length} מספרים הועתקו`), () => toast('לא הצלחנו להעתיק', true));
  };

  return (
    <>
      <PageHead title="מוזמנים" sub={`${guests.length} משפחות ברשימה`}>
        {canEdit && <button className="btn" onClick={() => openEdit()}>הוספת משפחה</button>}
      </PageHead>

      <div className="kpis mb-3" data-testid="guest-kpis">
        {kpis.map((k) => (
          <button key={k.key} type="button" className={`kpi ${k.on ? 'is-on' : ''} ${k.tone ?? ''}`} aria-pressed={k.on} onClick={k.go}>
            <b>{k.value}</b><span>{k.label}</span>
          </button>
        ))}
      </div>
      <div className="tabs mb-3" role="tablist">
        <button role="tab" aria-selected={view === 'list'} onClick={() => setView('list')}>כל המוזמנים</button>
        <button role="tab" aria-selected={view === 'dups'} data-testid="tab-dups" onClick={() => setView('dups')}>איתור כפילויות{dups.groups.length ? ` (${dups.groups.length})` : ''}</button>
      </div>
      {view === 'dups' && <DuplicatesPanel eventId={event.id} guests={guests} tables={tables} groups={dups.groups} merges={dups.merges} canEdit={canEdit}
        onChanged={async () => { await Promise.all([reload(), dups.refresh()]); }} onEdit={(g) => openEdit(g)} />}
      {view === 'list' && <>
      <div className="card mb-3 grid grid-cols-2 gap-2 p-3 lg:grid-cols-[1.4fr_repeat(3,1fr)_auto] [&>input]:col-span-2 lg:[&>input]:col-span-1">
        <input className="field" type="search" placeholder="חיפוש לפי שם, טלפון או קבוצה" aria-label="חיפוש" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="field" aria-label="סינון לפי סטטוס" value={fStatus} onChange={(e) => setFStatus(e.target.value as GuestStatus | '')}>
          <option value="">כל הסטטוסים</option>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select className="field" aria-label="סינון לפי קבוצה" value={fGroup} onChange={(e) => setFGroup(e.target.value)}>
          <option value="">כל הקבוצות</option>{groups.map((g) => <option key={g}>{g}</option>)}
        </select>
        <select className="field" aria-label="סינון לפי שולחן" value={fTable} onChange={(e) => setFTable(e.target.value)}>
          <option value="">כל השולחנות</option><option value="none">ללא שולחן</option>{tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <label className="flex items-center gap-2 px-2 text-sm font-semibold"><input type="checkbox" checked={vipOnly} onChange={(e) => setVipOnly(e.target.checked)} />VIP בלבד</label>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">מוצגות {rows.length} מתוך {guests.length}</span>
        {(q || fStatus || fGroup || fTable || vipOnly || quick) && <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>ניקוי הסינון</button>}
        <select className="field !w-auto !min-h-9 !py-1 lg:hidden" aria-label="מיון" value={`${sort.key}:${sort.dir}`} onChange={(e) => { const [key, dir] = e.target.value.split(':'); setSort({ key: key as SortKey, dir: Number(dir) as 1 | -1 }); }}>
          <option value="family_name:1">לפי שם</option><option value="created_at:-1">נרשמו אחרונים</option><option value="created_at:1">נרשמו ראשונים</option><option value="status:1">לפי סטטוס</option><option value="total:-1">לפי מספר משתתפים</option>
        </select>
        <span className="ms-auto flex flex-wrap gap-2">
          <button type="button" className="btn btn-ghost btn-sm" disabled={!rows.length} onClick={() => setPicked(picked.size === rows.length ? new Set() : new Set(rows.map((g) => g.id)))}>{picked.size && picked.size === rows.length ? 'ביטול הבחירה' : 'בחירת כל המוצגים'}</button>
        </span>
      </div>
      {picked.size > 0 && (
        <div className="bulk mb-3" data-testid="bulk">
          <b>{picked.size} נבחרו</b>
          <span className="text-sm text-muted">{chosen.filter((g) => g.phone).length} עם טלפון · {chosen.filter((g) => g.status === 'attending').reduce((n, g) => n + total(g), 0)} מגיעים</span>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-sm" onClick={() => exportChosen('xlsx')}>אקסל</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => exportChosen('csv')}>CSV</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => exportChosen('vcf')} title="קובץ אנשי קשר לייבוא לטלפון, כדי ליצור רשימת תפוצה ב-WhatsApp">אנשי קשר לטלפון (vCard)</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={copyPhones}>העתקת מספרים</button>
          </div>
          {canEdit && <div className="flex flex-wrap items-center gap-2">
            <input className="field !w-40 !min-h-9 !py-1" list="groups" placeholder="קבוצה" aria-label="קבוצה לכל הנבחרים" value={bulk.group} onChange={(e) => setBulk({ ...bulk, group: e.target.value })} />
            <button type="button" className="btn btn-ghost btn-sm" disabled={!bulk.group.trim() || busy} onClick={() => bulkSet({ group_name: bulk.group.trim() }, `הקבוצה עודכנה ל-${picked.size} משפחות`)}>שיוך לקבוצה</button>
            <select className="field !w-auto !min-h-9 !py-1" aria-label="סטטוס לכל הנבחרים" value="" onChange={(e) => e.target.value && bulkSet({ status: e.target.value as GuestStatus }, 'הסטטוס עודכן')}>
              <option value="">שינוי סטטוס…</option>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicked(new Set())}>ביטול הבחירה</button>
          </div>}
          <datalist id="groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
        </div>
      )}

      {!guests.length ? (
        <Empty title="הרשימה ריקה">הוסיפו משפחות כדי לשלוח לכל אחת קישור אישי עם מספר המקומות שהוקצה לה. אורחים שיאשרו דרך הקישור הכללי יתווספו לכאן לבד.</Empty>
      ) : !rows.length ? <Empty title="אין תוצאות לסינון הזה">נסו לשנות את החיפוש או לנקות את המסננים.</Empty> : (
        <>
        <ul className="grid gap-2 lg:hidden" data-testid="guests-cards">
          {rows.map((g) => (
            <li key={g.id} className={`card p-3.5 ${picked.has(g.id) ? 'is-picked' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <input type="checkbox" className="mt-1 !h-5 !w-5" aria-label={`בחירת ${g.family_name}`} checked={picked.has(g.id)} onChange={() => toggle(g.id)} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{g.is_vip && <span className="me-1 rounded bg-brass px-1.5 py-0.5 text-[11px] font-bold text-white">VIP</span>}{g.family_name}</div>
                  <div className="text-sm text-muted"><span dir="ltr">{g.phone || 'אין טלפון'}</span>{g.group_name ? ` · ${g.group_name}` : ''}</div>
                  <div className="text-xs text-muted" data-testid="registered">נרשם <span dir="ltr">{stamp(g.created_at)?.date} {stamp(g.created_at)?.time}</span>{dups.ids.has(g.id) && <button type="button" className="pill pill-maybe ms-2 !text-[11px]" onClick={() => setView('dups')}>כפילות אפשרית</button>}</div>
                </div>
                {canEdit ? (
                  <select className={`pill pill-${g.status} min-h-9 flex-none border-0 !text-[13px]`} aria-label={`סטטוס של ${g.family_name}`} value={g.status}
                    onChange={(e) => updateGuest(g.id, { status: e.target.value as GuestStatus }).then((ok) => ok && toast('הסטטוס עודכן'))}>
                    {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                ) : <StatusPill status={g.status} />}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
                {g.status !== 'pending' && g.status !== 'declined' && <span><b className="font-semibold text-text">{total(g)}</b> משתתפים ({g.adults} / {g.children} / {g.babies})</span>}
                {g.allocated_seats != null && <span>הוקצו {g.allocated_seats}</span>}
                {g.table_id && <span>{tname.get(g.table_id)}</span>}
                {g.arrived && <span className="font-semibold text-ok">הגיעו: {g.arrived_count ?? total(g)}</span>}
                {hasWa && <span>{g.opted_out ? 'לא לשלוח הודעות' : g.invited_at ? 'הזמנה נשלחה' : 'טרם הוזמנו'}</span>}
              </div>
              {[g.preferences, g.notes, g.admin_notes].some(Boolean) && <p className="mt-1.5 text-sm text-muted">{[g.preferences, g.notes, g.admin_notes].filter(Boolean).join(' · ')}</p>}
              <div className="mt-3 flex flex-wrap gap-1.5">
                <button className="btn btn-ghost btn-sm" onClick={() => copy(g)}>קישור אישי</button>
                {wa(g) && <a className="btn btn-ghost btn-sm" href={wa(g)!} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
                {canEdit && <>
                  <button className="btn btn-ghost btn-sm" onClick={() => g.arrived ? updateGuest(g.id, { arrived: false }) : setArrive({ g, n: total(g) || g.allocated_seats || 1 })}>{g.arrived ? 'ביטול הגעה' : 'סימון הגעה'}</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => openEdit(g)}>עריכה</button>
                </>}
              </div>
            </li>
          ))}
        </ul>
        <div className="card hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[1120px] text-sm" data-testid="guests-table">
            <thead className="border-b border-line bg-paper/60 text-muted">
              <tr>
                <th className="w-9 px-3 py-2.5"><input type="checkbox" aria-label="בחירת כל המוצגים" checked={rows.length > 0 && picked.size === rows.length} onChange={() => setPicked(picked.size === rows.length ? new Set() : new Set(rows.map((g) => g.id)))} /></th>
                {th('family_name', 'משפחה')}<th className="px-3 py-2.5 text-start font-semibold">טלפון</th>
                {th('allocated_seats', 'הוקצו')}{th('total', 'מבוגרים / ילדים / תינוקות')}{th('status', 'סטטוס')}{th('created_at', 'מועד הרשמה')}{th('responded_at', 'תשובה אחרונה')}
                <th className="px-3 py-2.5 text-start font-semibold">שולחן</th><th className="px-3 py-2.5 text-start font-semibold">הערות</th><th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((g) => (
                <tr key={g.id} className={`align-top hover:bg-paper/40 ${picked.has(g.id) ? 'is-picked' : ''}`}>
                  <td className="px-3 py-2.5"><input type="checkbox" aria-label={`בחירת ${g.family_name}`} checked={picked.has(g.id)} onChange={() => toggle(g.id)} /></td>
                  <td className="px-3 py-2.5">
                    {dups.ids.has(g.id) && <button type="button" className="pill pill-maybe mb-1 !text-[11px]" onClick={() => setView('dups')}>כפילות אפשרית</button>}
                    <div className="font-semibold">{g.is_vip && <span className="me-1 rounded bg-brass px-1.5 py-0.5 text-[11px] font-bold text-white">VIP</span>}{g.family_name}</div>
                    <div className="text-xs text-muted">{[g.contact_name !== g.family_name && g.contact_name, g.group_name].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td className="px-3 py-2.5" dir="ltr" style={{ textAlign: 'right' }}>{g.phone}</td>
                  <td className="px-3 py-2.5">{g.allocated_seats ?? '—'}</td>
                  <td className="px-3 py-2.5">{g.status === 'pending' || g.status === 'declined' ? '—' : <><b>{total(g)}</b> <span className="text-muted">({g.adults} / {g.children} / {g.babies})</span></>}</td>
                  <td className="px-3 py-2.5">
                    {canEdit ? (
                      <select className={`pill pill-${g.status} border-0`} aria-label={`סטטוס של ${g.family_name}`} value={g.status}
                        onChange={(e) => updateGuest(g.id, { status: e.target.value as GuestStatus }).then((ok) => ok && toast('הסטטוס עודכן'))}>
                        {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                      </select>
                    ) : <StatusPill status={g.status} />}
                    {g.arrived && <div className="mt-1 text-xs font-semibold text-ok">הגיעו: {g.arrived_count ?? total(g)}</div>}
                    {hasWa && <div className="mt-1 text-xs text-muted">{g.opted_out ? 'לא לשלוח הודעות' : g.invited_at ? 'הזמנה נשלחה' : 'טרם הוזמנו'}</div>}
                    {hasWa && g.status === 'attending' && !g.opted_out && (
                      <label className="mt-1 flex items-center gap-1.5 text-xs font-semibold">
                        <input type="checkbox" disabled={!canEdit} checked={g.reminders_enabled !== false} aria-label={`תזכורות אוטומטיות ל${g.family_name}`}
                          onChange={(e) => updateGuest(g.id, { reminders_enabled: e.target.checked })} />תזכורות
                      </label>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5" dir="ltr" style={{ textAlign: 'right' }} data-testid="registered"><div className="font-medium">{stamp(g.created_at)?.date}</div><div className="text-xs text-muted">{stamp(g.created_at)?.time}</div></td>
                  <td className="px-3 py-2.5 text-muted" dir="ltr" style={{ textAlign: 'right' }}>{fmtDateTime(g.responded_at)}</td>
                  <td className="px-3 py-2.5">{g.table_id ? tname.get(g.table_id) : <span className="text-muted">—</span>}</td>
                  <td className="max-w-52 px-3 py-2.5 text-xs text-muted">{[g.preferences, g.notes, g.admin_notes].filter(Boolean).join(' · ')}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap justify-end gap-1">
                      <button className="btn btn-ghost btn-sm" onClick={() => copy(g)}>קישור אישי</button>
                      {wa(g) && <a className="btn btn-ghost btn-sm" href={wa(g)!} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
                      {canEdit && <>
                        <button className="btn btn-ghost btn-sm" onClick={() => g.arrived ? updateGuest(g.id, { arrived: false }) : setArrive({ g, n: total(g) || g.allocated_seats || 1 })}>{g.arrived ? 'ביטול הגעה' : 'סימון הגעה'}</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => openEdit(g)}>עריכה</button>
                        <button className="btn btn-danger btn-sm" onClick={() => setDel(g)}>מחיקה</button>
                      </>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
      </>}

      {edit && (
        <Modal title={edit.id ? 'עריכת משפחה' : 'הוספת משפחה'} onClose={() => setEdit(null)} wide>
          <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
            <Field label="שם המשפחה"><input className="field" required maxLength={120} value={edit.draft.family_name} onChange={(e) => set('family_name', e.target.value)} /></Field>
            <Field label="איש קשר"><input className="field" maxLength={80} value={edit.draft.contact_name} onChange={(e) => set('contact_name', e.target.value)} /></Field>
            <Field label="טלפון"><input className="field" dir="ltr" type="tel" maxLength={20} value={edit.draft.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
            <Field label="מקומות שהוקצו" hint="האורחים לא יוכלו לאשר יותר מבוגרים וילדים מהמספר הזה."><input className="field" type="number" min={0} max={100} value={edit.draft.allocated_seats} onChange={(e) => set('allocated_seats', e.target.value === '' ? '' : Number(e.target.value))} /></Field>
            <Field label="סטטוס"><select className="field" value={edit.draft.status} onChange={(e) => set('status', e.target.value as GuestStatus)}>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="מבוגרים"><input className="field" type="number" min={0} max={100} value={edit.draft.adults} onChange={(e) => set('adults', Number(e.target.value))} /></Field>
              <Field label="ילדים"><input className="field" type="number" min={0} max={100} value={edit.draft.children} onChange={(e) => set('children', Number(e.target.value))} /></Field>
              <Field label="תינוקות"><input className="field" type="number" min={0} max={100} value={edit.draft.babies} onChange={(e) => set('babies', Number(e.target.value))} /></Field>
            </div>
            <Field label="קבוצה"><input className="field" list="groups" maxLength={60} placeholder="משפחה, חברים, עבודה" value={edit.draft.group_name} onChange={(e) => set('group_name', e.target.value)} />
              <datalist id="groups">{groups.map((g) => <option key={g} value={g} />)}</datalist></Field>
            <Field label="שולחן"><select className="field" value={edit.draft.table_id} onChange={(e) => set('table_id', e.target.value)}>
              <option value="">ללא שולחן</option>{tables.map((t) => <option key={t.id} value={t.id}>{t.name} ({tableLoad(t, guests).free} פנויים)</option>)}</select></Field>
            <label className="flex items-center gap-2 font-semibold sm:col-span-2"><input type="checkbox" checked={edit.draft.is_vip} onChange={(e) => set('is_vip', e.target.checked)} />אורח VIP</label>
            {hasWa && <>
              <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={edit.draft.reminders_enabled} onChange={(e) => set('reminders_enabled', e.target.checked)} />לכלול בתזכורות אוטומטיות</label>
              <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={edit.draft.opted_out} onChange={(e) => set('opted_out', e.target.checked)} />ביקשו לא לקבל הודעות WhatsApp</label>
            </>}
            <Field label="העדפות מיוחדות (מהאורח)"><input className="field" maxLength={500} value={edit.draft.preferences} onChange={(e) => set('preferences', e.target.value)} /></Field>
            <Field label="הערה מהאורח"><input className="field" maxLength={500} value={edit.draft.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
            <div className="sm:col-span-2"><Field label="הערות פנימיות (האורח לא רואה)"><textarea className="field" rows={2} maxLength={500} value={edit.draft.admin_notes} onChange={(e) => set('admin_notes', e.target.value)} /></Field></div>
            {current && (
              <div className="sm:col-span-2 grid gap-1 rounded-xl bg-paper/70 p-3 text-sm" data-testid="profile-times">
                <div><span className="text-muted">נרשם: </span><b dir="ltr">{stamp(current.created_at)?.date} {stamp(current.created_at)?.time}</b> <span className="text-muted">· {current.source === 'public' ? 'נרשם לבד מההזמנה' : 'הוזן על ידכם'}</span></div>
                <div><span className="text-muted">עודכן לאחרונה: </span><span dir="ltr">{stamp(current.updated_at)?.date} {stamp(current.updated_at)?.time}</span></div>
                {visits.length > 0 && <div><span className="text-muted">פתח את ההזמנה: </span>{visits.filter((v) => v.kind === 'view').length} פעמים, לאחרונה <span dir="ltr">{fmtDateTime(visits[0].created_at)}</span></div>}
              </div>
            )}
            {history.length > 0 && (
              <div className="sm:col-span-2">
                <div className="label">היסטוריית תשובות</div>
                <ul className="grid gap-1 text-sm">{history.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center gap-2"><span className="w-24 text-muted" dir="ltr" style={{ textAlign: 'right' }}>{fmtDateTime(h.created_at)}</span><StatusPill status={h.status} /><span>{h.adults} / {h.children} / {h.babies}</span>{h.arrived && <span className="pill pill-attending">הגיעו</span>}</li>
                ))}</ul>
              </div>
            )}
            {log.length > 0 && (
              <div className="sm:col-span-2">
                <div className="label">הודעות WhatsApp</div>
                <ul className="grid gap-1 text-sm">{log.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-2"><span className="w-24 text-muted" dir="ltr" style={{ textAlign: 'right' }}>{fmtDateTime(m.sent_at ?? m.created_at)}</span>
                    <span>{m.campaigns?.kind === 'reminder' ? 'תזכורת' : 'הזמנה'}: {m.campaigns?.name}</span>
                    <span className={`pill ${m.status === 'sent' ? 'pill-attending' : m.status === 'failed' ? 'pill-declined' : 'pill-pending'}`}>{m.status === 'sent' ? 'נשלחה' : m.status === 'failed' ? 'נכשלה' : m.status === 'skipped' ? 'דולגה' : 'ממתינה'}</span></li>
                ))}</ul>
              </div>
            )}
            <div className="flex gap-2 sm:col-span-2"><button className="btn" disabled={busy}>{edit.id ? 'שמירת השינויים' : 'הוספת המשפחה'}</button><button type="button" className="btn btn-ghost" onClick={() => setEdit(null)}>ביטול</button></div>
          </form>
        </Modal>
      )}
      {gone && (
        <div className="undo-bar no-print" role="status" data-testid="undo-delete">
          <span>{gone.name} נמחקה</span>
          <button type="button" onClick={bringBack}>ביטול המחיקה</button>
        </div>
      )}
      {del && (
        <Modal title="מחיקת משפחה" onClose={() => setDel(null)}>
          <p>למחוק את <b>{del.family_name}</b> מהרשימה? התשובה שלה והיסטוריית האישורים יימחקו, ואי אפשר לשחזר.</p>
          <div className="mt-4 flex gap-2"><button className="btn btn-danger" onClick={remove}>מחיקת המשפחה</button><button className="btn btn-ghost" onClick={() => setDel(null)}>ביטול</button></div>
        </Modal>
      )}
      {arrive && (
        <Modal title="סימון הגעה" onClose={() => setArrive(null)}>
          <Field label={`כמה הגיעו ממשפחת ${arrive.g.family_name}?`}><input className="field" type="number" min={0} max={300} autoFocus value={arrive.n} onChange={(e) => setArrive({ ...arrive, n: Number(e.target.value) })} /></Field>
          <div className="mt-4 flex gap-2">
            <button className="btn" onClick={async () => { const ok = await updateGuest(arrive.g.id, { arrived: true, arrived_count: arrive.n }); if (ok) toast('ההגעה נרשמה'); setArrive(null); }}>סימון הגעה</button>
            <button className="btn btn-ghost" onClick={() => setArrive(null)}>ביטול</button>
          </div>
        </Modal>
      )}
    </>
  );
}

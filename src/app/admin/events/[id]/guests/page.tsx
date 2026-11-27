'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useEvent } from '@/components/admin/EventContext';
import { PageHead } from '@/components/admin/Shell';
import { Empty, Field, Modal, StatusPill, dbError, fmtDateTime, useToast } from '@/components/admin/ui';
import { STATUS_LABEL, type Guest, type GuestStatus, type ResponseRow } from '@/lib/types';
import { intlPhone } from '@/lib/phone';
import { tableLoad } from '@/lib/stats';

type SortKey = 'family_name' | 'status' | 'responded_at' | 'total' | 'allocated_seats';
const STATUSES: GuestStatus[] = ['pending', 'attending', 'maybe', 'declined'];
const blank = { family_name: '', contact_name: '', phone: '', allocated_seats: '' as number | '', status: 'pending' as GuestStatus,
  adults: 0, children: 0, babies: 0, group_name: '', table_id: '', is_vip: false, admin_notes: '', reminders_enabled: true, opted_out: false };
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
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'family_name', dir: 1 });
  const [edit, setEdit] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [del, setDel] = useState<Guest | null>(null);
  const [arrive, setArrive] = useState<{ g: Guest; n: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<ResponseRow[]>([]);

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
      && (!fTable || (fTable === 'none' ? !g.table_id : g.table_id === fTable)) && (!vipOnly || g.is_vip));
    const val = (g: Guest) => sort.key === 'total' ? total(g) : sort.key === 'status' ? STATUSES.indexOf(g.status) : sort.key === 'allocated_seats' ? g.allocated_seats ?? -1 : g[sort.key] ?? '';
    return list.sort((a, b) => {
      const x = val(a), y = val(b);
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'he')) * sort.dir;
    });
  }, [guests, q, fStatus, fGroup, fTable, vipOnly, sort]);

  useEffect(() => {
    setHistory([]);
    if (!edit?.id) return;
    db.from('rsvp_responses').select('id,guest_id,status,adults,children,babies,arrived,source,created_at').eq('guest_id', edit.id)
      .order('created_at', { ascending: false }).limit(20).then(({ data }: { data: ResponseRow[] | null }) => setHistory(data ?? []));
    setLog([]);
    db.from('messages').select('id,status,sent_at,created_at,error,campaigns(name,kind)').eq('guest_id', edit.id).order('id', { ascending: false }).limit(20)
      .then(({ data }: { data: typeof log | null }) => setLog(data ?? []));
  }, [db, edit?.id]);

  const link = (g: Guest) => `${window.location.origin}/e/${event.slug}?g=${g.invite_token}`;
  const copy = (g: Guest) => navigator.clipboard.writeText(link(g)).then(() => toast('הקישור האישי הועתק'), () => toast('לא הצלחנו להעתיק', true));
  const wa = (g: Guest) => {
    const p = g.phone && intlPhone(g.phone);
    return p ? `https://wa.me/${p}?text=${encodeURIComponent(`${g.family_name} היקרים, נשמח לראותכם!\nלפרטים ולאישור הגעה:\n${link(g)}`)}` : null;
  };
  const openEdit = (g?: Guest) => setEdit(g ? { id: g.id, draft: { family_name: g.family_name, contact_name: g.contact_name ?? '', phone: g.phone ?? '',
    allocated_seats: g.allocated_seats ?? '', status: g.status, adults: g.adults, children: g.children, babies: g.babies, group_name: g.group_name ?? '',
    table_id: g.table_id ?? '', is_vip: g.is_vip, admin_notes: g.admin_notes ?? '', reminders_enabled: g.reminders_enabled !== false, opted_out: !!g.opted_out } } : { id: null, draft: { ...blank } });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!edit) return;
    const d = edit.draft;
    const patch = {
      family_name: d.family_name.trim(), contact_name: d.contact_name.trim() || null, phone: d.phone.trim() || null,
      allocated_seats: d.allocated_seats === '' ? null : Number(d.allocated_seats), status: d.status,
      adults: Number(d.adults) || 0, children: Number(d.children) || 0, babies: Number(d.babies) || 0,
      group_name: d.group_name.trim() || null, table_id: d.table_id || null, is_vip: d.is_vip, admin_notes: d.admin_notes.trim() || null,
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
    const { error } = await db.from('guests').delete().eq('id', del.id);
    if (error) toast(dbError(error), true); else { toast('המשפחה נמחקה'); await reload(); }
    setDel(null);
  }
  const th = (key: SortKey, label: string) => (
    <th className="px-3 py-2.5 text-start font-semibold" aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="inline-flex items-center gap-1" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))}>
        {label}<span className="text-xs text-muted">{sort.key === key ? (sort.dir === 1 ? '▲' : '▼') : ''}</span>
      </button>
    </th>
  );
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setEdit((s) => s && { ...s, draft: { ...s.draft, [k]: v } });

  return (
    <>
      <PageHead title="מוזמנים" sub={`${guests.length} משפחות ברשימה`}>
        {canEdit && <button className="btn" onClick={() => openEdit()}>הוספת משפחה</button>}
      </PageHead>

      <div className="card mb-3 grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(3,1fr)_auto]">
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

      {!guests.length ? (
        <Empty title="הרשימה ריקה">הוסיפו משפחות כדי לשלוח לכל אחת קישור אישי עם מספר המקומות שהוקצה לה. אורחים שיאשרו דרך הקישור הכללי יתווספו לכאן לבד.</Empty>
      ) : !rows.length ? <Empty title="אין תוצאות לסינון הזה">נסו לשנות את החיפוש או לנקות את המסננים.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm" data-testid="guests-table">
            <thead className="border-b border-line bg-paper/60 text-muted">
              <tr>
                {th('family_name', 'משפחה')}<th className="px-3 py-2.5 text-start font-semibold">טלפון</th>
                {th('allocated_seats', 'הוקצו')}{th('total', 'מבוגרים / ילדים / תינוקות')}{th('status', 'סטטוס')}{th('responded_at', 'תאריך אישור')}
                <th className="px-3 py-2.5 text-start font-semibold">שולחן</th><th className="px-3 py-2.5 text-start font-semibold">הערות</th><th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((g) => (
                <tr key={g.id} className="align-top hover:bg-paper/40">
                  <td className="px-3 py-2.5">
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
      )}

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
            <div className="sm:col-span-2"><Field label="הערות פנימיות (האורח לא רואה)"><textarea className="field" rows={2} maxLength={500} value={edit.draft.admin_notes} onChange={(e) => set('admin_notes', e.target.value)} /></Field></div>
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

'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CONFIDENCE_LABEL, duplicateIds, findDuplicates, type DupGroup } from '@/lib/duplicates';
import { STATUS_LABEL, type Guest, type TableRow } from '@/lib/types';
import { Modal, StatusPill, fmtDateTime, useToast } from './ui';

/** The duplicate groups of an event, minus the pairs someone already marked as different people. */
export function useDuplicates(eventId: string, guests: Guest[]) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [merges, setMerges] = useState<{ id: number; at: string; kept: string; names: string[] }[]>([]);
  const refresh = useCallback(async () => {
    const j = await fetch(`/api/admin/guests/duplicates?event=${eventId}`).then((r) => r.json()).catch(() => null);
    if (j?.ok) { setDismissed(new Set<string>(j.dismissed)); setMerges(j.merges); }
  }, [eventId]);
  useEffect(() => { void refresh(); }, [refresh]);
  const groups = useMemo(() => findDuplicates(guests, dismissed), [guests, dismissed]);
  const ids = useMemo(() => duplicateIds(groups), [groups]);
  return { groups, ids, merges, refresh };
}

const TONE: Record<string, string> = { very_high: 'pill-declined', high: 'pill-maybe', medium: 'pill-pending', low: 'pill-pending' };
const when = (iso: string) => { const d = new Date(iso), o = { timeZone: 'Asia/Jerusalem' } as const; return `${new Intl.DateTimeFormat('he-IL', { ...o, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d).replace(/\./g, '/')} ${new Intl.DateTimeFormat('he-IL', { ...o, hour: '2-digit', minute: '2-digit', hour12: false }).format(d)}`; };
const people = (g: Guest) => g.adults + g.children + g.babies;

type Props = { eventId: string; guests: Guest[]; tables: TableRow[]; groups: DupGroup[]; merges: { id: number; at: string; kept: string; names: string[] }[]; canEdit: boolean; onChanged: () => Promise<void>; onEdit: (g: Guest) => void };

export function DuplicatesPanel({ eventId, guests, tables, groups, merges, canEdit, onChanged, onEdit }: Props) {
  const toast = useToast();
  const [merge, setMerge] = useState<Guest[] | null>(null);
  const [busy, setBusy] = useState('');
  const byId = useMemo(() => new Map(guests.map((g) => [g.id, g])), [guests]);
  const tname = useMemo(() => new Map(tables.map((t) => [t.id, t.name])), [tables]);

  async function dismiss(g: DupGroup) {
    setBusy(g.key);
    const r = await fetch('/api/admin/guests/duplicates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'dismiss', eventId, ids: g.ids }) }).then((x) => x.json()).catch(() => null);
    setBusy('');
    if (!r?.ok) return toast(r?.message ?? 'לא הצלחנו לשמור.', true);
    toast('סומן: אנשים שונים. הקבוצה לא תוצג שוב.'); await onChanged();
  }

  if (!groups.length) {
    return (
      <div className="card p-6 text-center" data-testid="dups-empty">
        <p className="font-display text-lg font-medium">לא נמצאו כפילויות</p>
        <p className="mt-1 text-sm text-muted">המערכת משווה שמות ומספרי טלפון בכל פעם שהרשימה משתנה. כשתימצא התאמה היא תופיע כאן, ושום דבר לא יאוחד או יימחק בלי אישור שלך.</p>
        {merges.length > 0 && <MergeLog merges={merges} />}
      </div>
    );
  }
  return (
    <div className="grid gap-3" data-testid="dups">
      <p className="text-sm text-muted">{groups.length} קבוצות לבדיקה. שום דבר לא מאוחד או נמחק לבד: כל החלטה היא שלך.</p>
      {groups.map((grp) => {
        const list = grp.ids.map((id) => byId.get(id)).filter((g): g is Guest => !!g);
        return (
          <section key={grp.key} className={`card p-4 ${grp.critical ? 'dup-critical' : ''}`} data-testid="dup-group">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`pill ${TONE[grp.confidence]}`}>{CONFIDENCE_LABEL[grp.confidence]}</span>
              {grp.critical && <span className="pill pill-declined">תשובות סותרות</span>}
              <span className="text-sm">{grp.reasons.join(' · ')}</span>
            </div>
            <div className="dup-cards mt-3">
              {list.map((g) => (
                <article key={g.id} className="dup-card">
                  <div className="flex items-start justify-between gap-2"><b className="min-w-0 break-words">{g.family_name}</b><StatusPill status={g.status} /></div>
                  {g.contact_name && g.contact_name !== g.family_name && <div className="text-sm text-muted">{g.contact_name}</div>}
                  <dl className="mt-2 grid gap-1 text-sm">
                    <div><dt>טלפון</dt><dd dir="ltr">{g.phone || '—'}</dd></div>
                    <div><dt>משתתפים</dt><dd>{g.status === 'pending' || g.status === 'declined' ? '—' : `${people(g)} (${g.adults} / ${g.children} / ${g.babies})`}</dd></div>
                    <div><dt>נרשם</dt><dd dir="ltr">{when(g.created_at)}</dd></div>
                    <div><dt>מקור</dt><dd>{g.source === 'public' ? 'נרשם לבד מההזמנה' : 'הוזן על ידכם'}{g.invited_at ? ' · נשלחה הזמנה' : ''}</dd></div>
                    {(g.group_name || g.table_id) && <div><dt>שיוך</dt><dd>{[g.group_name, g.table_id && tname.get(g.table_id)].filter(Boolean).join(' · ')}</dd></div>}
                    {[g.preferences, g.notes, g.admin_notes].some(Boolean) && <div><dt>הערות</dt><dd>{[g.preferences, g.notes, g.admin_notes].filter(Boolean).join(' · ')}</dd></div>}
                  </dl>
                  {canEdit && <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={() => onEdit(g)}>עריכה</button>}
                </article>
              ))}
            </div>
            {canEdit && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                <button type="button" className="btn btn-sm" onClick={() => setMerge(list)}>איחוד לרשומה אחת</button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy === grp.key} onClick={() => dismiss(grp)}>אלה אנשים שונים</button>
              </div>
            )}
          </section>
        );
      })}
      {merges.length > 0 && <MergeLog merges={merges} />}
      {merge && <MergeModal eventId={eventId} list={merge} tables={tables} onClose={() => setMerge(null)} onDone={async () => { setMerge(null); await onChanged(); }} />}
    </div>
  );
}

function MergeLog({ merges }: { merges: Props['merges'] }) {
  return (
    <details className="card mt-3 p-4 text-start text-sm">
      <summary className="cursor-pointer font-semibold">איחודים שבוצעו ({merges.length})</summary>
      <ul className="mt-2 grid gap-1 text-muted">{merges.map((m) => <li key={m.id}><span dir="ltr">{fmtDateTime(m.at)}</span> · {m.names.join(', ')} אוחדו אל <b className="text-text">{m.kept}</b></li>)}</ul>
      <p className="mt-2 text-xs text-muted">הרשומות שאוחדו נשמרות במלואן ביומן המערכת, ואפשר לשחזר אותן משם אם איחוד נעשה בטעות.</p>
    </details>
  );
}

// ---- the merge: one value is chosen for every field, and the notes of all the records are kept together ----
type FieldKey = 'family_name' | 'contact_name' | 'phone' | 'answer' | 'allocated_seats' | 'group_name' | 'table_id' | 'is_vip';
const FIELDS: { key: FieldKey; label: string }[] = [
  { key: 'family_name', label: 'שם' }, { key: 'contact_name', label: 'איש קשר' }, { key: 'phone', label: 'טלפון' }, { key: 'answer', label: 'תשובה ומספר משתתפים' },
  { key: 'allocated_seats', label: 'מקומות שהוקצו' }, { key: 'group_name', label: 'קבוצה' }, { key: 'table_id', label: 'שולחן' }, { key: 'is_vip', label: 'VIP' },
];
const joinNotes = (list: Guest[], k: 'notes' | 'preferences' | 'admin_notes') => { const parts = [...new Set(list.flatMap((g) => (g[k] ?? '').split(/\s*[·\n]\s*/)).map((x) => x.trim()).filter(Boolean))]; return parts.length ? parts.join(' · ').slice(0, 1000) : null; };

function MergeModal({ eventId, list, tables, onClose, onDone }: { eventId: string; list: Guest[]; tables: TableRow[]; onClose: () => void; onDone: () => Promise<void> }) {
  const toast = useToast();
  const tname = new Map(tables.map((t) => [t.id, t.name]));
  const show = (g: Guest, k: FieldKey): string => k === 'answer' ? `${STATUS_LABEL[g.status]}${g.status === 'attending' || g.status === 'maybe' ? ` · ${people(g)} (${g.adults}/${g.children}/${g.babies})` : ''}`
    : k === 'table_id' ? (g.table_id ? tname.get(g.table_id) ?? '' : '') : k === 'is_vip' ? (g.is_vip ? 'כן' : 'לא') : k === 'allocated_seats' ? (g.allocated_seats == null ? '' : String(g.allocated_seats)) : (g[k] ?? '');
  // the record that stays: one that already got an invitation (its link is out there), otherwise the first registered
  const firstKeep = useMemo(() => [...list].sort((a, b) => Number(!!b.invited_at) - Number(!!a.invited_at) || a.created_at.localeCompare(b.created_at))[0].id, [list]);
  const [keepId, setKeepId] = useState(firstKeep);
  const best = (k: FieldKey): string => {
    if (k === 'answer') return [...list].sort((a, b) => (b.responded_at ?? '').localeCompare(a.responded_at ?? ''))[0].id;
    if (k === 'family_name') return [...list].sort((a, b) => b.family_name.trim().length - a.family_name.trim().length)[0].id;
    if (k === 'is_vip') return (list.find((g) => g.is_vip) ?? list[0]).id;
    return (list.find((g) => g.id === keepId && show(g, k)) ?? list.find((g) => show(g, k)) ?? list[0]).id;
  };
  const [pick, setPick] = useState<Record<FieldKey, string>>(() => Object.fromEntries(FIELDS.map((f) => [f.key, best(f.key)])) as Record<FieldKey, string>);
  const [busy, setBusy] = useState(false);
  const from = (k: FieldKey) => list.find((g) => g.id === pick[k]) ?? list[0];
  const conflict = (k: FieldKey) => new Set(list.map((g) => show(g, k)).filter(Boolean)).size > 1;
  const a = from('answer');
  const patch = {
    family_name: from('family_name').family_name.trim(), contact_name: from('contact_name').contact_name?.trim() || null, phone: from('phone').phone?.trim() || null,
    status: a.status, adults: a.adults, children: a.children, babies: a.babies,
    allocated_seats: from('allocated_seats').allocated_seats, group_name: from('group_name').group_name?.trim() || null, table_id: from('table_id').table_id, is_vip: from('is_vip').is_vip,
    notes: joinNotes(list, 'notes'), preferences: joinNotes(list, 'preferences'), admin_notes: joinNotes(list, 'admin_notes'),
  };
  const before = list.filter((g) => g.status === 'attending').reduce((n, g) => n + people(g), 0);
  const after = patch.status === 'attending' ? patch.adults + patch.children + patch.babies : 0;

  async function go() {
    setBusy(true);
    const r = await fetch('/api/admin/guests/duplicates', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'merge', eventId, keepId, mergeIds: list.filter((g) => g.id !== keepId).map((g) => g.id), patch }) }).then((x) => x.json()).catch(() => null);
    setBusy(false);
    if (!r?.ok && !r?.partial) return toast(r?.message ?? 'האיחוד נכשל. שום רשומה לא השתנתה.', true);
    toast(r.partial ? r.message : 'הרשומות אוחדו', !!r.partial); await onDone();
  }

  return (
    <Modal title="איחוד רשומות" onClose={onClose} wide>
      <div className="grid gap-4" data-testid="merge">
        <p className="text-sm text-muted">בוחרים לכל שדה איזה ערך נשאר. ההערות של כל הרשומות נשמרות יחד, היסטוריית התשובות וההודעות עוברת לרשומה שנשארת, ומועד ההרשמה יהיה המוקדם מביניהן.</p>
        <fieldset>
          <legend className="label">הרשומה שנשארת (הקישור האישי שלה ימשיך לעבוד)</legend>
          <div className="merge-opts">{list.map((g) => (
            <label key={g.id} className={keepId === g.id ? 'is-on' : ''}><input type="radio" name="keep" className="sr-only" checked={keepId === g.id} onChange={() => setKeepId(g.id)} />
              <b>{g.family_name}</b><small>נרשם <span dir="ltr">{when(g.created_at)}</span>{g.invited_at ? ' · נשלחה הזמנה' : ''}</small></label>
          ))}</div>
        </fieldset>
        {FIELDS.filter((f) => list.some((g) => show(g, f.key))).map((f) => (
          <fieldset key={f.key} data-conflict={conflict(f.key)}>
            <legend className="label">{f.label}{conflict(f.key) && <span className="ms-2 text-xs font-semibold text-warn">ערכים שונים: בחרו</span>}</legend>
            <div className="merge-opts">{[...new Map(list.map((g) => [show(g, f.key) || '—', g])).entries()].map(([text, g]) => (
              <label key={g.id} className={show(from(f.key), f.key) === show(g, f.key) ? 'is-on' : ''}><input type="radio" name={f.key} className="sr-only" checked={show(from(f.key), f.key) === show(g, f.key)} onChange={() => setPick((p) => ({ ...p, [f.key]: g.id }))} />
                <b dir={f.key === 'phone' ? 'ltr' : undefined}>{text}</b></label>
            ))}</div>
          </fieldset>
        ))}
        <div className="notice">
          <b>אחרי האיחוד:</b> רשומה אחת בשם <b>{patch.family_name}</b>, {STATUS_LABEL[patch.status]}{after ? `, ${after} משתתפים` : ''}.
          {before !== after && <> סך המגיעים באירוע ישתנה ב-<b dir="ltr">{after - before > 0 ? '+' : ''}{after - before}</b>.</>}
          {list.length - 1 > 0 && <> {list.length - 1 === 1 ? 'רשומה אחת תוסר' : `${list.length - 1} רשומות יוסרו`} מהרשימה ויישמרו ביומן המערכת.</>}
        </div>
        <div className="flex flex-wrap gap-2"><button type="button" className="btn" disabled={busy} onClick={go}>{busy ? 'מאחדים…' : 'אישור האיחוד'}</button><button type="button" className="btn btn-ghost" onClick={onClose}>ביטול</button></div>
      </div>
    </Modal>
  );
}

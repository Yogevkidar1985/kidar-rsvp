'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useEvent } from '@/components/admin/EventContext';
import { PageHead } from '@/components/admin/Shell';
import { Field, Modal, StatusPill, dbError, useToast } from '@/components/admin/ui';
import { CampaignList, GreenNotice, MessageEditor, SetupNotice, useOutbox, useRender, type PreviewGuest } from '@/components/admin/outbox';
import { BUILTIN, TEMPLATE_GROUPS, templateGroup, variableLabel, type Template, type TemplateGroup, type TemplateKind } from '@/lib/templates';
import { STATUS_LABEL, type Guest, type GuestStatus } from '@/lib/types';
import { normPhone } from '@/lib/phone';

const TABS = ['שליחה', 'תבניות', 'היסטוריה'] as const;
const STATUSES: GuestStatus[] = ['pending', 'attending', 'maybe', 'declined'];
const today = () => new Intl.DateTimeFormat('he-IL', { day: '2-digit', month: '2-digit' }).format(new Date());

export default function WhatsAppPage() {
  const { event, guests, canEdit, reload } = useEvent();
  const db = supabaseBrowser();
  const toast = useToast();
  const box = useOutbox();
  const rr = useRender(event);
  const [tab, setTab] = useState<(typeof TABS)[number]>('שליחה');
  const [mode, setMode] = useState<'bulk' | 'one'>('bulk');
  const [q, setQ] = useState('');
  const [fStatus, setFStatus] = useState<GuestStatus | ''>('');
  const [fInvited, setFInvited] = useState<'' | 'no' | 'yes'>('no');
  const [fGroup, setFGroup] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [resend, setResend] = useState(false);
  const [tplGroup, setTplGroup] = useState<TemplateGroup | ''>('');
  const [groupName, setGroupName] = useState('');
  const [one, setOne] = useState({ guestId: '', name: '', phone: '', save: true });
  const templates = box.templates('invite');
  const [templateId, setTemplateId] = useState('');
  const [body, setBody] = useState('');
  const [name, setName] = useState(`הזמנות ${today()}`);
  const [confirm, setConfirm] = useState(false);
  const [testPhones, setTestPhones] = useState('');
  const [tested, setTested] = useState(false);
  const [checks, setChecks] = useState<boolean[]>([false, false, false]);
  const CHECKS = ['עברתי על נוסח ההודעה', 'עברתי על ההזמנה בתצוגה המקדימה', 'בדקתי את התאריך, השעה והמקום'];
  const [sending, setSending] = useState(false);
  const [edit, setEdit] = useState<{ id: string | null; kind: TemplateKind; name: string; body: string; is_default: boolean } | null>(null);

  useEffect(() => {
    if (templateId || !templates.length) return;
    const t = templates.find((x) => x.is_default) ?? templates[0];
    setTemplateId(t.id); setBody(t.body);
  }, [templates, templateId]);

  const groups = useMemo(() => [...new Set(guests.map((g) => g.group_name).filter(Boolean))] as string[], [guests]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase(), digits = needle.replace(/\D/g, '');
    return guests.filter((g) =>
      (!needle || [g.family_name, g.contact_name].some((v) => v?.toLowerCase().includes(needle)) || (digits.length > 2 && (g.phone ?? '').replace(/\D/g, '').includes(digits)))
      && (!fStatus || g.status === fStatus) && (!fGroup || g.group_name === fGroup)
      && (!fInvited || (fInvited === 'yes' ? !!g.invited_at : !g.invited_at)));
  }, [guests, q, fStatus, fGroup, fInvited]);
  const chosen = useMemo(() => guests.filter((g) => picked.has(g.id)), [guests, picked]);
  const sums = useMemo(() => {
    const noPhone = chosen.filter((g) => !normPhone(g.phone)).length;
    const opted = chosen.filter((g) => g.opted_out).length;
    const invited = chosen.filter((g) => g.invited_at && normPhone(g.phone) && !g.opted_out).length;
    return { noPhone, opted, invited, eligible: chosen.length - noPhone - opted - (resend ? 0 : invited) };
  }, [chosen, resend]);
  const oneGuest = guests.find((g) => g.id === one.guestId);
  const first: PreviewGuest | undefined = mode === 'bulk' ? chosen.find((g) => normPhone(g.phone))
    : oneGuest ?? (one.name ? { family_name: one.name, contact_name: one.name, invite_token: '' } : undefined);
  const { missing } = rr(body, first);
  const ready = !missing.length && body.trim() && name.trim() && (mode === 'bulk' ? sums.eligible > 0 : oneGuest ? !!normPhone(oneGuest.phone) : one.name.trim().length > 1 && !!normPhone(one.phone));
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function send() {
    setSending(true);
    const payload = {
      eventId: event.id, kind: 'invite', name: name.trim(), templateName: templates.find((t) => t.id === templateId)?.name ?? null, body, allowResend: resend,
      ...(mode === 'bulk' ? { guestIds: [...picked] } : oneGuest ? { guestIds: [oneGuest.id] } : { manual: { name: one.name.trim(), phone: one.phone, save: one.save } }),
    };
    const r = await fetch('/api/admin/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const j = await r.json().catch(() => null);
    setSending(false); setConfirm(false);
    if (!r.ok || !j?.ok) return toast(j?.message ?? 'לא הצלחנו ליצור את הקמפיין.', true);
    toast(`${j.queued} הודעות נכנסו לתור השליחה`);
    setPicked(new Set()); setOne({ guestId: '', name: '', phone: '', save: true }); setTab('היסטוריה');
    await Promise.all([box.load(), reload()]);
  }
  async function test() {
    const phones = testPhones.split(/[,\s]+/).map((p) => p.trim()).filter(Boolean).slice(0, 3);
    const r = await fetch('/api/admin/campaigns/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId: event.id, body, ...(phones.length ? { phones } : {}) }) });
    const j = await r.json().catch(() => null);
    if (j?.ok) setTested(true);
    toast(j?.ok ? `הודעת בדיקה נשלחה ל-${j.sent} ${phones.length ? 'מספרי בדיקה' : 'מספרים של המארחים'}` : j?.message ?? 'הבדיקה נכשלה', !j?.ok);
  }
  async function assignGroup() {
    const g = groupName.trim();
    if (!g || !picked.size) return;
    const { error } = await db.from('guests').update({ group_name: g }).in('id', [...picked]);
    if (error) return toast(dbError(error), true);
    toast(`${picked.size} משפחות שויכו לקבוצה "${g}"`); setGroupName(''); await reload();
  }
  async function saveTemplate(e: React.FormEvent) {
    e.preventDefault();
    if (!edit) return;
    if (edit.is_default) await db.from('message_templates').update({ is_default: false }).eq('event_id', event.id).eq('kind', edit.kind);
    const row = { event_id: event.id, kind: edit.kind, name: edit.name.trim(), body: edit.body.trim(), is_default: edit.is_default };
    const { error } = edit.id ? await db.from('message_templates').update(row).eq('id', edit.id) : await db.from('message_templates').insert(row);
    if (error) return toast(dbError(error), true);
    toast('התבנית נשמרה'); setEdit(null); await box.load();
  }
  async function removeTemplate(t: Template) {
    const { error } = await db.from('message_templates').delete().eq('id', t.id);
    if (error) return toast(dbError(error), true);
    toast('התבנית נמחקה'); await box.load();
  }

  if (box.state === 'loading') return <div className="grid gap-3" aria-busy="true" aria-label="טוענים"><div className="skeleton h-9 w-48" /><div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><div className="skeleton h-24" /><div className="skeleton h-24" /><div className="skeleton h-24" /><div className="skeleton h-24" /></div><div className="skeleton h-56" /></div>;
  if (box.state === 'setup') return <><PageHead title="הזמנות WhatsApp" /><SetupNotice /></>;
  const all = box.messages.filter((m) => box.campaigns.find((c) => c.id === m.campaign_id)?.kind === 'invite');
  const stat = (s: string) => all.filter((m) => m.status === s).length;

  return (
    <>
      <PageHead title="הזמנות WhatsApp" sub={`${guests.filter((g) => g.invited_at).length} מתוך ${guests.length} משפחות כבר קיבלו הזמנה`}>
        <a className="btn btn-ghost" href={`/admin/events/${event.id}/links`}>עריכת הקישורים</a>
      </PageHead>
      <GreenNotice green={box.green} />
      {!event.published && <p className="notice notice-warn mb-3">ההזמנה עדיין לא מפורסמת. מפרסמים אותה ב"עיצוב ההזמנה" לפני השליחה, אחרת הקישור לא ייפתח.</p>}
      <div className="tabs mb-4 w-fit max-w-full" role="tablist">
        {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t}</button>)}
      </div>

      {tab === 'שליחה' && (
        <fieldset disabled={!canEdit} className="grid gap-4">
          <div className="tabs w-fit max-w-full">
            {([['bulk', 'שליחה לרבים'], ['one', 'הזמנה לאדם אחד']] as const).map(([k, l]) => (
              <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)}>{l}</button>
            ))}
          </div>

          {mode === 'bulk' ? (
            <section className="card p-4">
              <h2 className="font-display text-lg font-medium">1. בחירת נמענים</h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <input className="field" type="search" placeholder="חיפוש לפי שם או טלפון" aria-label="חיפוש" value={q} onChange={(e) => setQ(e.target.value)} />
                <select className="field" aria-label="קבלת הזמנה" value={fInvited} onChange={(e) => setFInvited(e.target.value as typeof fInvited)}>
                  <option value="no">טרם קיבלו הזמנה</option><option value="yes">כבר קיבלו הזמנה</option><option value="">כולם</option></select>
                <select className="field" aria-label="סטטוס" value={fStatus} onChange={(e) => setFStatus(e.target.value as GuestStatus | '')}>
                  <option value="">כל הסטטוסים</option>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
                <select className="field" aria-label="קבוצה" value={fGroup} onChange={(e) => setFGroup(e.target.value)}>
                  <option value="">כל הקבוצות</option>{groups.map((g) => <option key={g}>{g}</option>)}</select>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicked((s) => new Set([...s, ...shown.map((g) => g.id)]))}>סימון כל המוצגים ({shown.length})</button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={!picked.size} onClick={() => setPicked(new Set())}>ניקוי הסימון</button>
                <span className="text-muted">{guests.length} אנשי קשר · {picked.size} מסומנים</span>
              </div>
              <ul className="mt-2 max-h-80 divide-y divide-line overflow-y-auto rounded-xl border border-line" data-testid="recipients">
                {!shown.length && <li className="p-4 text-sm text-muted">אין אורחים שמתאימים לסינון.</li>}
                {shown.map((g) => (
                  <li key={g.id}>
                    <label className="flex min-h-12 items-center gap-3 px-3 py-2">
                      <input type="checkbox" className="h-5 w-5 flex-none" checked={picked.has(g.id)} onChange={() => toggle(g.id)} />
                      <span className="min-w-0 flex-1"><b className="block truncate">{g.family_name}</b><span className="text-xs text-muted" dir="ltr">{g.phone || 'אין טלפון'}</span></span>
                      {g.opted_out ? <span className="pill pill-declined">לא לשלוח</span> : g.invited_at ? <span className="pill pill-attending">הוזמנו</span> : null}
                      <StatusPill status={g.status} />
                    </label>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
                <Field label="שמירת המסומנים כקבוצה"><input className="field" list="wa-groups" maxLength={60} placeholder="משפחה קרובה, חברים, עבודה" value={groupName} onChange={(e) => setGroupName(e.target.value)} /></Field>
                <datalist id="wa-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
                <button type="button" className="btn btn-ghost" disabled={!groupName.trim() || !picked.size} onClick={assignGroup}>שיוך לקבוצה</button>
              </div>
            </section>
          ) : (
            <section className="card grid gap-3 p-4 sm:grid-cols-2">
              <h2 className="font-display text-lg font-medium sm:col-span-2">1. למי שולחים</h2>
              <Field label="אורח מהרשימה">
                <select className="field" value={one.guestId} onChange={(e) => setOne({ ...one, guestId: e.target.value })}>
                  <option value="">מספר חדש (לא ברשימה)</option>
                  {guests.map((g) => <option key={g.id} value={g.id}>{g.family_name}{g.phone ? ` · ${g.phone}` : ' · אין טלפון'}</option>)}
                </select>
              </Field>
              {!one.guestId && <>
                <Field label="שם הנמען"><input className="field" maxLength={80} value={one.name} onChange={(e) => setOne({ ...one, name: e.target.value })} /></Field>
                <Field label="טלפון נייד"><input className="field" dir="ltr" type="tel" inputMode="tel" maxLength={20} value={one.phone} onChange={(e) => setOne({ ...one, phone: e.target.value })} /></Field>
                <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={one.save} onChange={(e) => setOne({ ...one, save: e.target.checked })} />להוסיף לרשימת המוזמנים (מקבל קישור אישי)</label>
              </>}
              {oneGuest && !normPhone(oneGuest.phone) && <p className="text-sm font-semibold text-no sm:col-span-2">לאורח הזה אין מספר טלפון תקין.</p>}
            </section>
          )}

          <section className="card p-4">
            <h2 className="mb-3 font-display text-lg font-medium">2. ההודעה</h2>
            <MessageEditor kind="invite" templates={templates} body={body} setBody={setBody} templateId={templateId} setTemplateId={setTemplateId} previewFor={first} />
          </section>

          <section className="card p-4">
            <h2 className="font-display text-lg font-medium">3. כך האורח יראה את ההזמנה</h2>
            <p className="mt-1 text-sm text-muted">זו ההזמנה האמיתית, במצב בדיקה: אפשר לגלול, ללחוץ על אישור הגעה ולראות את מסך התודה. שום דבר לא נשמר.</p>
            {event.published ? (
              <div className="mt-4 grid items-start gap-5 lg:grid-cols-[340px_1fr]">
                <div className="phone"><iframe title="תצוגה מקדימה של ההזמנה" src={`/${event.slug}?test=1`} loading="lazy" /></div>
                <div className="grid content-start gap-3">
                  <a className="btn btn-ghost w-fit" href={`/${event.slug}?test=1`} target="_blank" rel="noopener noreferrer">פתיחה במסך מלא</a>
                  <Field label="שליחת הודעת בדיקה ב-WhatsApp" hint="עד שלושה מספרים, מופרדים בפסיק. בלי מספר, הבדיקה נשלחת למספרי המארחים. הקישור בהודעה נפתח במצב בדיקה.">
                    <input className="field" dir="ltr" inputMode="tel" placeholder="050-0000000" value={testPhones} onChange={(e) => setTestPhones(e.target.value)} /></Field>
                  <button type="button" className="btn btn-ghost w-fit" disabled={!!missing.length || !body.trim()} onClick={test}>שליחת הודעת בדיקה</button>
                  {tested && <p className="text-sm font-medium text-ok">הודעת בדיקה נשלחה. פתחו אותה בטלפון ועברו על ההזמנה.</p>}
                </div>
              </div>
            ) : <p className="notice notice-warn mt-3">התצוגה המקדימה זמינה אחרי פרסום ההזמנה.</p>}
          </section>

          <section className="card grid gap-3 p-4">
            <h2 className="font-display text-lg font-medium">4. שליחה</h2>
            <Field label="שם הקמפיין (לשימוש פנימי)"><input className="field sm:max-w-md" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={resend} onChange={(e) => setResend(e.target.checked)} />שליחה חוזרת גם למי שכבר קיבל הזמנה</label>
            {mode === 'bulk' && (
              <dl className="grid grid-cols-2 gap-2 text-center text-sm sm:grid-cols-4" data-testid="send-summary">
                {([['מסומנים', chosen.length], ['יקבלו הודעה', sums.eligible], ['כבר הוזמנו', sums.invited], ['לא יישלח', sums.noPhone + sums.opted]] as const).map(([l, v]) => (
                  <div key={l} className="rounded-lg bg-paper px-1 py-2"><dd className="text-xl font-semibold tabular-nums">{v}</dd><dt className="text-xs text-muted">{l}</dt></div>
                ))}
              </dl>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn" disabled={!ready} onClick={() => { setChecks([false, false, false]); setConfirm(true); }}>המשך לאישור השליחה</button>
            </div>
            <p className="text-xs text-muted">ההודעות נשלחות אחת אחת, בערך הודעה בשנייה, כדי לא לסכן את מספר ה-WhatsApp. שלחו רק לאנשים שמכירים אתכם ומצפים להזמנה.</p>
          </section>
        </fieldset>
      )}

      {tab === 'תבניות' && (
        <div className="grid gap-4">
          {canEdit && <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={() => setEdit({ id: null, kind: 'invite', name: '', body: '', is_default: false })}>תבנית הזמנה חדשה</button>
            <button className="btn btn-ghost" onClick={() => setEdit({ id: null, kind: 'reminder', name: '', body: '', is_default: false })}>תבנית תזכורת חדשה</button>
          </div>}
          <div className="tabs tabs-wrap" role="group" aria-label="סוג התבנית" data-testid="tpl-groups">
            <button type="button" aria-pressed={tplGroup === ''} onClick={() => setTplGroup('')}>הכול</button>
            {TEMPLATE_GROUPS.map((g) => <button key={g.key} type="button" aria-pressed={tplGroup === g.key} onClick={() => setTplGroup(g.key)}>{g.label}</button>)}
          </div>
          {TEMPLATE_GROUPS.filter((g) => !tplGroup || tplGroup === g.key).map(({ key: grp, label, hint }) => { const k: TemplateKind = grp === 'reminder' ? 'reminder' : 'invite'; return (
            <section key={grp} data-testid={`tpl-${grp}`}>
              <h2 className="font-display text-lg font-medium">{label}</h2>
              <p className="mb-2 text-sm text-muted">{hint}</p>
              <div className="grid gap-2 md:grid-cols-2">
                {[...box.custom.filter((t) => templateGroup(t) === grp), ...BUILTIN.filter((t) => templateGroup(t) === grp)].map((t) => (
                  <article key={t.id} className="card flex flex-col p-4">
                    <h3 className="font-semibold">{t.name} {t.builtin ? <span className="pill pill-pending">מוכנה</span> : <span className="pill pill-maybe">שלי</span>} {t.is_default && <span className="pill pill-attending">ברירת מחדל</span>}</h3>
                    <p className="mt-2 line-clamp-5 whitespace-pre-wrap text-sm text-muted">{t.body}</p>
                    {canEdit && <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
                      {t.builtin ? <button className="btn btn-ghost btn-sm" onClick={() => setEdit({ id: null, kind: k, name: `${t.name} (עותק)`, body: t.body, is_default: false })}>שכפול ועריכה</button> : <>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEdit({ id: t.id, kind: k, name: t.name, body: t.body, is_default: !!t.is_default })}>עריכה</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEdit({ id: null, kind: k, name: `${t.name} (עותק)`, body: t.body, is_default: false })}>שכפול</button>
                        <button className="btn btn-danger btn-sm" onClick={() => removeTemplate(t)}>מחיקה</button>
                      </>}
                    </div>}
                  </article>
                ))}
              </div>
            </section>
          ); })}
        </div>
      )}

      {tab === 'היסטוריה' && (
        <div className="grid gap-4">
          <dl className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4" data-testid="invite-totals">
            {([['נשלחו בהצלחה', stat('sent')], ['נכשלו', stat('failed')], ['ממתינות', stat('pending') + stat('sending')], ['דולגו', stat('skipped')]] as const).map(([l, v]) => (
              <div key={l} className="card stat text-start"><dt>{l}</dt><dd>{v}</dd></div>
            ))}
          </dl>
          <CampaignList kind="invite" box={box} empty="עדיין לא נשלחו הזמנות." />
        </div>
      )}

      {confirm && (
        <Modal title="אישור שליחה" onClose={() => setConfirm(false)}>
          <p>{mode === 'bulk' ? <>ההזמנה תישלח ל-<b>{sums.eligible}</b> נמענים דרך WhatsApp.</> : <>ההזמנה תישלח אל <b>{oneGuest?.family_name ?? one.name}</b>.</>}</p>
          {mode === 'bulk' && (sums.invited > 0 && !resend) && <p className="mt-1 text-sm text-muted">{sums.invited} שכבר קיבלו הזמנה לא יקבלו אותה שוב.</p>}
          {mode === 'bulk' && sums.noPhone + sums.opted > 0 && <p className="mt-1 text-sm text-muted">{sums.noPhone + sums.opted} בלי טלפון תקין או שביקשו לא לקבל הודעות.</p>}
          <p className="mt-2 text-sm text-muted">תבנית: {templates.find((t) => t.id === templateId)?.name}. אי אפשר לבטל הודעה שכבר נשלחה.</p>
          <div className="mt-3 grid gap-2 border-t border-line pt-3">
            {CHECKS.map((c, i) => <label key={c} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={checks[i]} onChange={(e) => setChecks((l) => l.map((x, j) => (j === i ? e.target.checked : x)))} />{c}</label>)}
            <p className="text-xs text-muted">{tested ? 'נשלחה הודעת בדיקה בסשן הזה.' : 'עדיין לא נשלחה הודעת בדיקה. מומלץ לשלוח אחת לפני השליחה לכולם.'}</p>
          </div>
          <div className="mt-4 flex gap-2"><button className="btn" disabled={sending || checks.some((x) => !x)} onClick={send}>{sending ? 'מכינים…' : 'שליחה עכשיו'}</button><button className="btn btn-ghost" onClick={() => setConfirm(false)}>ביטול</button></div>
        </Modal>
      )}
      {edit && (
        <Modal title={edit.id ? 'עריכת תבנית' : 'תבנית חדשה'} onClose={() => setEdit(null)} wide>
          <form onSubmit={saveTemplate} className="grid gap-3">
            <Field label="שם התבנית"><input className="field" required maxLength={80} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <MessageEditor kind={edit.kind} templates={[]} body={edit.body} setBody={(b) => setEdit((s) => s && { ...s, body: b })} templateId="" setTemplateId={() => {}} />
            <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={edit.is_default} onChange={(e) => setEdit({ ...edit, is_default: e.target.checked })} />ברירת המחדל {edit.kind === 'invite' ? 'להזמנות' : 'לתזכורות'}</label>
            {rr(edit.body).missing.length > 0 && <p className="text-xs text-muted">שימו לב: {rr(edit.body).missing.map(variableLabel).join(', ')} עדיין בלי ערך באירוע.</p>}
            <div className="flex gap-2"><button className="btn" disabled={!edit.name.trim() || !edit.body.trim()}>שמירת התבנית</button><button type="button" className="btn btn-ghost" onClick={() => setEdit(null)}>ביטול</button></div>
          </form>
        </Modal>
      )}
    </>
  );
}

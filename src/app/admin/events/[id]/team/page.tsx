'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useEvent } from '@/components/admin/EventContext';
import { PageHead } from '@/components/admin/Shell';
import { Field, dbError, useToast } from '@/components/admin/ui';
import type { Role } from '@/lib/types';

const ROLE: Record<Role, string> = { owner: 'בעלים: הכול, כולל צוות וחיבורים', editor: 'עריכה: מוזמנים, שולחנות ועיצוב', viewer: 'צפייה בלבד' };
type Member = { user_id: string; email: string; full_name: string | null; role: Role };
type Invite = { id: string; email: string; role: Role };

export default function TeamPage() {
  const { event, isOwner } = useEvent();
  const toast = useToast();
  const db = supabaseBrowser();
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [me, setMe] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('viewer');

  const load = useCallback(async () => {
    const [m, i, u] = await Promise.all([
      db.rpc('list_members', { p_event: event.id }),
      db.from('admin_invites').select('id,email,role').eq('event_id', event.id).order('created_at'),
      db.auth.getUser(),
    ]);
    setMembers((m.data as Member[]) ?? []); setInvites((i.data as Invite[]) ?? []); setMe(u.data.user?.id ?? '');
  }, [db, event.id]);
  useEffect(() => { void load(); }, [load]);

  if (!isOwner) return <p className="text-muted">המסך הזה פתוח לבעלי האירוע בלבד.</p>;
  const pending = invites.filter((i) => !members.some((m) => m.email === i.email));
  const owners = members.filter((m) => m.role === 'owner').length;

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await db.from('admin_invites').insert({ email: email.trim().toLowerCase(), event_id: event.id, role, invited_by: me });
    if (error) return toast(error.code === '23505' ? 'הכתובת הזו כבר הוזמנה לאירוע.' : dbError(error), true);
    setEmail(''); toast('ההזמנה נשמרה. שלחו לאדם את כתובת המערכת כדי שייצור חשבון.'); await load();
  }
  async function setMemberRole(m: Member, r: Role) {
    if (m.role === 'owner' && r !== 'owner' && owners < 2) return toast('חייב להישאר לפחות בעלים אחד לאירוע.', true);
    const { error } = await db.from('event_members').update({ role: r }).eq('event_id', event.id).eq('user_id', m.user_id);
    if (error) toast(dbError(error), true); else toast('ההרשאה עודכנה');
    await load();
  }
  async function removeMember(m: Member) {
    if (m.role === 'owner' && owners < 2) return toast('חייב להישאר לפחות בעלים אחד לאירוע.', true);
    const { error } = await db.from('event_members').delete().eq('event_id', event.id).eq('user_id', m.user_id);
    await db.from('admin_invites').delete().eq('event_id', event.id).eq('email', m.email);
    if (error) toast(dbError(error), true); else toast('הגישה הוסרה');
    await load();
  }

  return (
    <>
      <PageHead title="צוות והרשאות" sub="רק מי שמופיע כאן יכול להיכנס לנתוני האירוע." />
      <section className="card p-5">
        <h2 className="font-display text-lg font-medium">בעלי גישה</h2>
        <ul className="mt-2 divide-y divide-line text-sm">
          {members.map((m) => (
            <li key={m.user_id} className="flex flex-wrap items-center gap-3 py-2.5">
              <span dir="ltr" className="font-semibold">{m.email}</span>{m.user_id === me && <span className="pill pill-pending">אני</span>}
              <select className="field ms-auto !w-auto" aria-label={`הרשאה של ${m.email}`} value={m.role} onChange={(e) => setMemberRole(m, e.target.value as Role)}>
                {(Object.keys(ROLE) as Role[]).map((r) => <option key={r} value={r}>{ROLE[r]}</option>)}</select>
              {m.user_id !== me && <button className="btn btn-danger btn-sm" onClick={() => removeMember(m)}>הסרת גישה</button>}
            </li>
          ))}
        </ul>
        {pending.length > 0 && <>
          <h3 className="mt-5 text-sm font-semibold text-muted">הוזמנו ועדיין לא יצרו חשבון</h3>
          <ul className="divide-y divide-line text-sm">
            {pending.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-2"><span dir="ltr">{i.email}</span><span className="text-muted">{ROLE[i.role].split(':')[0]}</span>
                <button className="btn btn-danger btn-sm ms-auto" onClick={async () => { await db.from('admin_invites').delete().eq('id', i.id); await load(); }}>ביטול ההזמנה</button></li>
            ))}
          </ul>
        </>}
      </section>
      <form onSubmit={invite} className="card mt-4 grid gap-3 p-5 sm:grid-cols-[2fr_1.4fr_auto] sm:items-end">
        <Field label="אימייל של המשתמש החדש"><input className="field" dir="ltr" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="הרשאה"><select className="field" value={role} onChange={(e) => setRole(e.target.value as Role)}>{(Object.keys(ROLE) as Role[]).map((r) => <option key={r} value={r}>{ROLE[r]}</option>)}</select></Field>
        <button className="btn">הזמנת המשתמש</button>
      </form>
    </>
  );
}

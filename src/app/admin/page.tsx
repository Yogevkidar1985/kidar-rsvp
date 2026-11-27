import { redirect } from 'next/navigation';
import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';
import NewEvent from '@/components/admin/NewEvent';

export const dynamic = 'force-dynamic';

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const db = await supabaseServer();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect('/admin/login');
  const { data: events } = await db.from('events').select('id,name,slug,event_date,published').order('created_at', { ascending: false });
  const list = events ?? [];
  if (list.length === 1 && !(await searchParams).all) redirect(`/admin/events/${list[0].id}`);
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="font-display text-3xl font-medium">האירועים שלי</h1>
      <p className="mt-1 text-muted">{user.email}</p>
      <div className="mt-6 grid gap-3">
        {list.map((e) => (
          <Link key={e.id} href={`/admin/events/${e.id}`} className="card flex items-center justify-between gap-3 p-4 hover:border-ink">
            <div>
              <div className="font-semibold">{e.name}</div>
              <div className="text-sm text-muted" dir="ltr" style={{ textAlign: 'right' }}>/e/{e.slug}</div>
            </div>
            <span className={`pill ${e.published ? 'pill-attending' : 'pill-pending'}`}>{e.published ? 'פורסמה' : 'טיוטה'}</span>
          </Link>
        ))}
        {!list.length && <div className="card p-6 text-center text-muted">עדיין אין אירועים בחשבון הזה. צרו את הראשון כאן למטה.</div>}
      </div>
      <NewEvent sources={list.map((e) => ({ id: e.id, name: e.name }))} />
    </main>
  );
}

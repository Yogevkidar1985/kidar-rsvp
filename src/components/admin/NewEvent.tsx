'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

export default function NewEvent({ sources }: { sources: { id: string; name: string }[] }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [from, setFrom] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (!/^[a-z0-9][a-z0-9-]{2,60}$/.test(slug)) return setErr('הכתובת צריכה להכיל 3 תווים לפחות: אותיות קטנות באנגלית, ספרות ומקפים.');
    setBusy(true);
    const db = supabaseBrowser();
    let id: string | null = null, error: { message?: string; code?: string } | null = null;
    if (from) {
      const r = await db.rpc('duplicate_event', { p_event: from, p_slug: slug, p_name: name });
      id = r.data as string | null; error = r.error;
    } else {
      const { data: { user } } = await db.auth.getUser();
      const r = await db.from('events').insert({ name, slug, created_by: user?.id }).select('id').single();
      id = r.data?.id ?? null; error = r.error;
    }
    setBusy(false);
    if (error || !id) return setErr(error?.code === '23505' ? 'הכתובת הזו כבר תפוסה. בחרו כתובת אחרת.' : 'לא הצלחנו ליצור את האירוע. לשכפול נדרשת הרשאת בעלים.');
    router.push(`/admin/events/${id}/editor`);
  }
  return (
    <form onSubmit={create} className="card mt-8 grid gap-3 p-5">
      <h2 className="font-display text-xl font-medium">אירוע חדש</h2>
      <label><span className="label">שם האירוע</span>
        <input className="field" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label><span className="label">כתובת ההזמנה (באנגלית)</span>
        <input className="field" dir="ltr" required placeholder="family-event" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} /></label>
      {sources.length > 0 && (
        <label><span className="label">להתחיל מעיצוב של אירוע קיים</span>
          <select className="field" value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">הזמנה ריקה</option>
            {sources.map((s) => <option key={s.id} value={s.id}>שכפול: {s.name}</option>)}
          </select></label>
      )}
      {err && <p role="alert" className="notice notice-bad">{err}</p>}
      <button className="btn justify-self-start" disabled={busy}>יצירת האירוע</button>
    </form>
  );
}

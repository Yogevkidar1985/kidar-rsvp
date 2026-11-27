'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

export default function ResetPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 10) return setMsg('הסיסמה צריכה להכיל לפחות 10 תווים.');
    setBusy(true);
    const { error } = await supabaseBrowser().auth.updateUser({ password });
    setBusy(false);
    if (error) return setMsg('הקישור פג תוקף. בקשו קישור חדש ממסך הכניסה.');
    router.replace('/admin'); router.refresh();
  }
  return (
    <main className="grid min-h-dvh place-items-center bg-ink px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-white p-6">
        <h1 className="font-display text-xl font-medium">בחירת סיסמה חדשה</h1>
        <label className="mt-4 block"><span className="label">סיסמה חדשה</span>
          <input className="field" type="password" dir="ltr" autoComplete="new-password" minLength={10} required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {msg && <p role="alert" className="notice notice-bad mt-3">{msg}</p>}
        <button className="btn mt-4 w-full" disabled={busy}>שמירת הסיסמה</button>
      </form>
    </main>
  );
}

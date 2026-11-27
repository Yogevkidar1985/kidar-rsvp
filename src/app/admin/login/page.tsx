'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** A bare screen with one unlabeled, masked field: the team's code opens the admin. */
export default function LockPage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [bad, setBad] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code || busy) return;
    setBusy(true); setBad(false);
    try {
      const res = await fetch('/api/unlock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
      if (res.ok) { router.replace('/admin'); router.refresh(); return; }
      setBad(true); setCode('');
    } catch { setBad(true); } finally { setBusy(false); }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-ink px-4">
      <form onSubmit={submit}>
        <input
          type="password" inputMode="numeric" autoComplete="off" autoFocus aria-label="קוד" dir="ltr"
          value={code} onChange={(e) => { setCode(e.target.value); setBad(false); }} disabled={busy}
          className={`w-40 rounded-xl border bg-white/5 px-4 py-3 text-center text-xl tracking-[0.5em] text-white outline-none focus:border-white/40 ${bad ? 'border-[#c9665c]' : 'border-white/10'}`}
        />
        <button type="submit" className="sr-only">כניסה</button>
      </form>
    </main>
  );
}

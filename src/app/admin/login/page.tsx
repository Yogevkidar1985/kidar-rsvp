'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

type Mode = 'login' | 'signup' | 'forgot';
const TITLE: Record<Mode, string> = { login: 'כניסה למערכת', signup: 'יצירת חשבון למוזמנים', forgot: 'איפוס סיסמה' };
const ACTION: Record<Mode, string> = { login: 'כניסה', signup: 'יצירת חשבון', forgot: 'שליחת קישור לאיפוס' };

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null); setBusy(true);
    const db = supabaseBrowser();
    const origin = window.location.origin;
    try {
      if (mode === 'login') {
        const { error } = await db.auth.signInWithPassword({ email, password });
        if (error) return setMsg({ text: error.message.includes('not confirmed') ? 'צריך לאשר את האימייל לפני הכניסה. חפשו את הודעת האישור בתיבה.' : 'האימייל או הסיסמה שגויים.', bad: true });
        router.replace('/admin'); router.refresh();
      } else if (mode === 'signup') {
        if (password.length < 10) return setMsg({ text: 'הסיסמה צריכה להכיל לפחות 10 תווים.', bad: true });
        const { data, error } = await db.auth.signUp({ email, password, options: { emailRedirectTo: `${origin}/auth/callback?next=/admin` } });
        if (error) return setMsg({ text: /database error|not_invited/i.test(error.message) ? 'האימייל הזה לא הוזמן למערכת. בקשו מבעלי האירוע להזמין אתכם.' : 'לא הצלחנו ליצור את החשבון. נסו שוב.', bad: true });
        if (data.session) { router.replace('/admin'); router.refresh(); }
        else setMsg({ text: 'שלחנו אימייל לאישור הכתובת. לחצו על הקישור שבו ואז היכנסו.' });
      } else {
        await db.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/callback?next=/admin/reset` });
        setMsg({ text: 'אם הכתובת רשומה במערכת, נשלח אליה קישור לאיפוס הסיסמה.' });
      }
    } finally { setBusy(false); }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-ink px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center text-white">
          <div className="font-display text-3xl">KIDAR RSVP</div>
          <div className="mt-1 text-sm text-white/60">ניהול אישורי הגעה · גרסה 2.0</div>
        </div>
        <form onSubmit={submit} className="rounded-2xl bg-white p-6">
          <h1 className="font-display text-xl font-medium">{TITLE[mode]}</h1>
          <div className="mt-4 grid gap-3">
            <label><span className="label">אימייל</span>
              <input className="field" type="email" dir="ltr" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            {mode !== 'forgot' && (
              <label><span className="label">סיסמה</span>
                <input className="field" type="password" dir="ltr" required minLength={mode === 'signup' ? 10 : 1}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            )}
          </div>
          {msg && <p role={msg.bad ? 'alert' : 'status'} className={`mt-3 rounded-lg px-3 py-2 text-sm font-semibold ${msg.bad ? 'bg-[#f8e4e2] text-[#9a3a32]' : 'bg-[#e4f2ea] text-[#1f6a49]'}`}>{msg.text}</p>}
          <button className="btn mt-4 w-full" disabled={busy}>{busy ? 'רגע…' : ACTION[mode]}</button>
          <div className="mt-4 flex flex-wrap justify-between gap-2 text-sm">
            {mode !== 'login' && <button type="button" className="underline" onClick={() => { setMode('login'); setMsg(null); }}>חזרה לכניסה</button>}
            {mode === 'login' && <button type="button" className="underline" onClick={() => { setMode('forgot'); setMsg(null); }}>שכחתי סיסמה</button>}
            {mode === 'login' && <button type="button" className="underline" onClick={() => { setMode('signup'); setMsg(null); }}>הוזמנתי, אין לי חשבון</button>}
          </div>
        </form>
        <p className="mt-4 text-center text-xs text-white/50">הגישה למערכת פתוחה רק למי שהוזמן על ידי בעלי האירוע.</p>
      </div>
    </main>
  );
}

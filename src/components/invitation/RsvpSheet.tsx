'use client';
import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { GuestStatus, PublicGuest } from '@/lib/types';
import { normPhone } from '@/lib/phone';
import { successLottie } from './successLottie';

const Lottie = dynamic(() => import('lottie-react'), { ssr: false });
type Answer = Exclude<GuestStatus, 'pending'>;
export type RsvpResult = { status: Answer; adults: number; children: number; babies: number };
type Props = {
  slug: string; token: string | null; guest?: PublicGuest; maxParty: number; accent: string;
  onClose: () => void; onSaved: (r: RsvpResult) => void;
};
type Saved = { name: string; phone: string };

const STATUSES: { key: Answer; label: string }[] = [
  { key: 'attending', label: 'מגיעים' }, { key: 'maybe', label: 'אולי' }, { key: 'declined', label: 'לא מגיעים' },
];
const THANKS: Record<Answer, [string, string]> = {
  attending: ['תודה, נתראה בשמחה', 'התשובה נשמרה. אפשר לעדכן אותה בכל רגע מאותו קישור.'],
  maybe: ['תודה, רשמנו שאולי תגיעו', 'נשמח לתשובה סופית כשתדעו. אפשר לעדכן מאותו קישור.'],
  declined: ['תודה שעדכנתם', 'חבל שלא תוכלו להגיע. אם משהו ישתנה, אפשר לעדכן מאותו קישור.'],
};

function Stepper({ label, hint, value, set, max }: { label: string; hint?: string; value: number; set: (n: number) => void; max: number }) {
  return (
    <div className="stepper">
      <span><b style={{ fontWeight: 600 }}>{label}</b>{hint && <small style={{ display: 'block', color: '#6a778e' }}>{hint}</small>}</span>
      <div>
        <button type="button" aria-label={`פחות ${label}`} disabled={value <= 0} onClick={() => set(value - 1)}>−</button>
        <output aria-live="polite">{value}</output>
        <button type="button" aria-label={`עוד ${label}`} disabled={value >= max} onClick={() => set(value + 1)}>+</button>
      </div>
    </div>
  );
}

export default function RsvpSheet({ slug, token, guest, maxParty, accent, onClose, onSaved }: Props) {
  const answered = guest && guest.status !== 'pending';
  const [name, setName] = useState(guest?.contact_name || guest?.family_name || '');
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState<Answer | null>(answered ? (guest!.status as Answer) : null);
  const [adults, setAdults] = useState(answered ? guest!.adults : 2);
  const [children, setChildren] = useState(answered ? guest!.children : 0);
  const [babies, setBabies] = useState(answered ? guest!.babies : 0);
  const [preferences, setPreferences] = useState(guest?.preferences ?? '');
  const [notes, setNotes] = useState(guest?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<Answer | null>(null);
  const first = useRef<HTMLInputElement>(null);
  const key = `rsvp:${slug}:${token ?? ''}`;

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(key) ?? 'null') as Saved | null;
      if (s) { setPhone((p) => p || s.phone); setName((n) => n || s.name); }
    } catch { /* storage unavailable */ }
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    first.current?.focus({ preventScroll: true });
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', esc); };
  }, [key, onClose]);

  const seatCap = guest?.allocated_seats ?? null;
  const seated = adults + children;
  const total = seated + babies;
  const roomSeats = seatCap !== null ? seatCap - seated : maxParty - total;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (name.trim().length < 2) return setError('נא למלא שם מלא.');
    if (!normPhone(phone)) return setError('מספר הטלפון אינו תקין.');
    if (!status) return setError('נא לבחור אם אתם מגיעים.');
    if (status === 'attending' && seated < 1) return setError('נא לציין כמה מגיעים.');
    setBusy(true);
    try {
      const res = await fetch('/api/rsvp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, token, name, phone, status, adults, children, babies, notes, preferences }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) { setError(json?.message ?? 'לא הצלחנו לשמור את התשובה. נסו שוב.'); return; }
      try { localStorage.setItem(key, JSON.stringify({ name: name.trim(), phone } satisfies Saved)); } catch { /* ignore */ }
      setDone(status);
      onSaved({ status, ...json.guest });
    } catch {
      setError('אין חיבור לשרת. בדקו את החיבור ונסו שוב.');
    } finally { setBusy(false); }
  }

  return (
    <div className="sheet-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="אישור הגעה" dir="rtl">
        {done ? (
          <div style={{ textAlign: 'center', padding: '8px 0 6px' }} data-testid="rsvp-success">
            <div style={{ width: 150, height: 150, margin: '0 auto' }}>
              <Lottie animationData={successLottie(done === 'declined' ? '#6A778E' : accent)} loop={false} />
            </div>
            <h2 style={{ font: '500 28px/1.2 "Frank Ruhl Libre", serif', margin: '4px 0 8px' }}>{THANKS[done][0]}</h2>
            {done !== 'declined' && total > 0 && <p style={{ margin: '0 0 6px', fontWeight: 700 }}>נרשמו {total} משתתפים</p>}
            <p style={{ margin: 0, color: '#6a778e', lineHeight: 1.6 }}>{THANKS[done][1]}</p>
            <div style={{ display: 'grid', gap: 8, marginTop: 22 }}>
              <button type="button" className="inv-cta" style={{ marginTop: 0, background: '#1e2a44', color: '#fff', boxShadow: 'none' }} onClick={onClose}>חזרה להזמנה</button>
              <button type="button" className="inv-chip" style={{ justifyContent: 'center', color: '#1e2a44' }} onClick={() => setDone(null)}>עדכון התשובה</button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} noValidate>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12 }}>
              <div>
                <h2 style={{ font: '500 26px/1.2 "Frank Ruhl Libre", serif', margin: 0 }}>{answered ? 'עדכון אישור ההגעה' : 'אישור הגעה'}</h2>
                {guest && <p style={{ margin: '4px 0 0', color: '#6a778e' }}>{guest.family_name}{seatCap !== null ? ` · שמורים לכם ${seatCap} מקומות` : ''}</p>}
              </div>
              <button type="button" aria-label="סגירה" onClick={onClose} style={{ width: 40, height: 40, borderRadius: '50%', border: 0, background: '#eef1f5', fontSize: 20, color: '#1e2a44' }}>×</button>
            </div>

            <div style={{ display: 'grid', gap: 12, marginTop: 18 }}>
              <label><span className="label">שם מלא</span>
                <input ref={first} className="field" name="name" autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} required /></label>
              <label><span className="label">טלפון נייד</span>
                <input className="field" name="phone" type="tel" inputMode="tel" autoComplete="tel" dir="ltr" style={{ textAlign: 'right' }} maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} required /></label>
            </div>

            <fieldset style={{ border: 0, padding: 0, margin: '18px 0 0' }}>
              <legend className="label">מגיעים?</legend>
              <div className="seg">
                {STATUSES.map((s) => (
                  <button key={s.key} type="button" aria-pressed={status === s.key} onClick={() => setStatus(s.key)}>{s.label}</button>
                ))}
              </div>
            </fieldset>

            {status && status !== 'declined' && (
              <div style={{ marginTop: 12 }}>
                <Stepper label="מבוגרים" value={adults} set={setAdults} max={adults + Math.max(0, roomSeats)} />
                <Stepper label="ילדים" value={children} set={setChildren} max={children + Math.max(0, roomSeats)} />
                <Stepper label="תינוקות" hint="ללא כיסא" value={babies} set={setBabies} max={seatCap !== null ? 10 : babies + Math.max(0, roomSeats)} />
                <p style={{ display: 'flex', justifyContent: 'space-between', margin: '12px 0 0', fontWeight: 700 }}>
                  <span>סה״כ משתתפים</span><span data-testid="rsvp-total">{total}</span>
                </p>
                <label style={{ display: 'block', marginTop: 14 }}><span className="label">העדפות מיוחדות (צמחוני, כיסא תינוק, נגישות)</span>
                  <input className="field" maxLength={500} value={preferences} onChange={(e) => setPreferences(e.target.value)} /></label>
              </div>
            )}
            <label style={{ display: 'block', marginTop: 12 }}><span className="label">הערות לבעלי האירוע</span>
              <textarea className="field" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>

            {error && <p role="alert" style={{ margin: '12px 0 0', padding: '10px 12px', borderRadius: 10, background: '#f8e4e2', color: '#9a3a32', fontWeight: 600 }}>{error}</p>}
            <button type="submit" className="inv-cta" style={{ marginTop: 16, background: '#1e2a44', color: '#fff', boxShadow: 'none' }} disabled={busy}>
              {busy ? 'שומרים…' : answered ? 'עדכון התשובה' : 'שליחת התשובה'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

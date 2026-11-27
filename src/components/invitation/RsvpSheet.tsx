'use client';
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import type { GuestStatus, PublicGuest } from '@/lib/types';
import { normPhone } from '@/lib/phone';
import { partyLottie, successLottie } from './lotties';
import { useDialogFocus } from '@/lib/dialog';

const Lottie = dynamic(() => import('lottie-react'), { ssr: false });
export type Answer = Exclude<GuestStatus, 'pending'>;
export type RsvpResult = { status: Answer; adults: number; children: number; babies: number };
type Props = {
  slug: string; token: string | null; guest?: PublicGuest; maxParty: number; accent: string; /** colours of the pieces thrown when an answer is saved */ colors?: string[];
  /** the answer picked on the invitation itself */
  initial?: Answer | null;
  /** test mode: validate and show the thank-you screen without sending anything to the server */
  test?: boolean;
  onClose: () => void; onSaved: (r: RsvpResult) => void;
};
type Saved = { name: string; phone: string };

const STATUSES: { key: Answer; label: string }[] = [
  { key: 'attending', label: 'מגיעים' }, { key: 'maybe', label: 'עדיין לא בטוחים' }, { key: 'declined', label: 'לא מגיעים' },
];
const THANKS: Record<Answer, [string, string]> = {
  attending: ['תודה, נתראה בשמחה', 'התשובה נשמרה. אפשר לעדכן אותה בכל רגע מאותו קישור.'],
  maybe: ['תודה, רשמנו שאתם עדיין לא בטוחים', 'נשמח לתשובה סופית כשתדעו. אפשר לעדכן מאותו קישור.'],
  declined: ['תודה שעדכנתם', 'חבל שלא תוכלו להגיע. אם משהו ישתנה, אפשר לעדכן מאותו קישור.'],
};

/** The preferences most guests have, kashrut first. */
const PREFS = ['כשרות (מחפוד)', 'צמחוני', 'כיסא תינוק', 'נגישות'];
function splitPrefs(text: string | null | undefined) {
  const parts = (text ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  return { picked: PREFS.filter((p) => parts.includes(p)), other: parts.filter((p) => !PREFS.includes(p)).join(', ') };
}

function Stepper({ label, hint, value, set, max }: { label: string; hint?: string; value: number; set: (n: number) => void; max: number }) {
  return (
    <div className="stepper">
      <span><b style={{ fontWeight: 600 }}>{label}</b>{hint && <small style={{ display: 'block', color: 'var(--inv-dim)' }}>{hint}</small>}</span>
      <div>
        <button type="button" aria-label={`פחות ${label}`} disabled={value <= 0} onClick={() => set(value - 1)}>−</button>
        <output aria-live="polite">{value}</output>
        <button type="button" aria-label={`עוד ${label}`} disabled={value >= max} onClick={() => set(value + 1)}>+</button>
      </div>
    </div>
  );
}

export default function RsvpSheet({ slug, token, guest, maxParty, accent, colors, initial = null, test = false, onClose: close, onSaved }: Props) {
  const [closing, setClosing] = useState(false);
  // plays the exit, then hands control back; a second request while it plays is ignored
  const leaving = useRef(false);
  const onClose = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true; setClosing(true);
    window.setTimeout(close, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180);
  }, [close]);
  const answered = guest && guest.status !== 'pending';
  const [name, setName] = useState(guest?.contact_name || guest?.family_name || '');
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState<Answer | null>(initial ?? (answered ? (guest!.status as Answer) : null));
  const [adults, setAdults] = useState(answered ? guest!.adults : 2);
  const [children, setChildren] = useState(answered ? guest!.children : 0);
  const [babies, setBabies] = useState(answered ? guest!.babies : 0);
  // preferences: the common ones are one tap each, anything else is typed. Both end up in the one text the owners read.
  const [picked, setPicked] = useState<string[]>(() => splitPrefs(guest?.preferences ?? '').picked);
  const [other, setOther] = useState(() => splitPrefs(guest?.preferences ?? '').other);
  const preferences = [...PREFS.filter((p) => picked.includes(p)), other.trim()].filter(Boolean).join(', ');
  const togglePref = (p: string) => setPicked((c) => (c.includes(p) ? c.filter((x) => x !== p) : [...c, p]));
  const [notes, setNotes] = useState(guest?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [bad, setBad] = useState<{ name?: string; phone?: string; status?: string; count?: string }>({});
  const phoneRef = useRef<HTMLInputElement>(null);
  const back = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState<Answer | null>(null);
  // the note stays folded away until someone wants it: most guests never do
  const [more, setMore] = useState(false);
  const check = useMemo(() => successLottie(accent), [accent]);
  const party = useMemo(() => partyLottie(colors?.length ? colors : [accent]), [colors, accent]);
  const first = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useDialogFocus(box);
  const key = `rsvp:${slug}:${token ?? ''}`;

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(key) ?? 'null') as Saved | null;
      if (s) { setPhone((p) => p || s.phone); setName((n) => n || s.name); }
    } catch { /* storage unavailable */ }
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', esc); };
  }, [key, onClose]);

  // On a phone the keyboard covers the bottom of the screen without resizing it. The sheet follows the part that is
  // really visible, and the field being typed in is kept in view.
  useEffect(() => {
    const vv = window.visualViewport, el = back.current;
    if (!vv || !el) return;
    const fit = () => { el.style.setProperty('--vvh', `${vv.height}px`); el.style.setProperty('--vvt', `${vv.offsetTop}px`); };
    fit(); vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit);
    const show = (e: FocusEvent) => { const t = e.target as HTMLElement; if (t.matches?.('input, textarea')) window.setTimeout(() => t.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250); };
    el.addEventListener('focusin', show);
    return () => { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); el.removeEventListener('focusin', show); };
  }, []);
  /** Enter on the keyboard goes to the next field, and closes the keyboard on the last one. It never sends the form by surprise. */
  const enter = (next?: () => void) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (next) next(); else (e.target as HTMLInputElement).blur();
  };

  const seatCap = guest?.allocated_seats ?? null;
  const seated = adults + children;
  const total = seated + babies;
  const roomSeats = seatCap !== null ? seatCap - seated : maxParty - total;

  /** The code this phone was given when it first answered from the general link. */
  const ownKey = (): string | null => { try { const k = localStorage.getItem(`${key}:own`); return k && /^[A-Za-z0-9][A-Za-z0-9-]{3,23}$/.test(k) ? k : null; } catch { return null; } };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const found: typeof bad = {};
    if (!status) found.status = 'נא לבחור אם אתם מגיעים.';
    if (status === 'attending' && seated < 1) found.count = 'נא לציין כמה מגיעים.';
    if (name.trim().length < 2) found.name = 'נא למלא שם מלא.';
    if (phone.trim() && !normPhone(phone)) found.phone = 'המספר לא נראה תקין. דוגמה: 050-1234567';
    setBad(found);
    if (Object.keys(found).length) {
      // the first problem gets the focus, so the guest lands on what to fix
      if (found.status || found.count) box.current?.scrollTo({ top: 0, behavior: 'smooth' });
      else if (found.name) first.current?.focus(); else phoneRef.current?.focus();
      return;
    }
    if (!status) return;
    if (test) { setDone(status); onSaved({ status, adults, children, babies }); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/rsvp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, token: token ?? ownKey(), name, phone: phone.trim(), status, adults, children, babies, notes, preferences }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        if (json?.code === 'INVALID_PHONE') { setBad({ phone: json.message }); phoneRef.current?.focus(); return; }
        if (json?.code === 'INVALID_LINK' && !token && ownKey()) { try { localStorage.removeItem(`${key}:own`); } catch { /* ignore */ } }
        setError(json?.message ?? 'לא הצלחנו לשמור את התשובה. נסו שוב.'); return;
      }
      if (json.key) { try { localStorage.setItem(`${key}:own`, json.key); } catch { /* ignore */ } }
      try { localStorage.setItem(key, JSON.stringify({ name: name.trim(), phone } satisfies Saved)); } catch { /* ignore */ }
      setDone(status);
      onSaved({ status, ...json.guest });
    } catch {
      setError('אין חיבור לשרת. בדקו את החיבור ונסו שוב.');
    } finally { setBusy(false); }
  }

  return (
    <div ref={back} className={`sheet-back${closing ? ' closing' : ''}`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} tabIndex={-1} className="sheet" role="dialog" aria-modal="true" aria-label="אישור הגעה" dir="rtl">
        {done ? (
          <div className="sheet-thanks" style={{ textAlign: 'center', padding: '8px 0 6px' }} data-testid="rsvp-success">
            <div className="sheet-done">
              {done !== 'declined' && <div className="sheet-party" aria-hidden="true" data-testid="rsvp-party"><Lottie animationData={party} loop={false} /></div>}
              <div className="sheet-check"><Lottie animationData={check} loop={false} /></div>
            </div>
            <h2 className="sheet-title" style={{ margin: '4px 0 8px' }}>{THANKS[done][0]}</h2>
            {done !== 'declined' && total > 0 && <p style={{ margin: '0 0 6px', fontWeight: 600 }}>נרשמו {total} משתתפים</p>}
            <p style={{ margin: 0, color: 'var(--inv-dim)', lineHeight: 1.6 }}>{test ? 'מצב בדיקה: כך ייראה המסך לאורח. התשובה לא נשמרה.' : THANKS[done][1]}</p>
            <div style={{ display: 'grid', gap: 8, marginTop: 22 }}>
              <button type="button" className="inv-btn" onClick={onClose}>חזרה להזמנה</button>
              <button type="button" className="inv-btn ghost" onClick={() => setDone(null)}>עדכון התשובה</button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} noValidate>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12 }}>
              <div>
                <h2 className="sheet-title">{answered ? 'עדכון אישור ההגעה' : 'אישור הגעה'}</h2>
                {guest && <p style={{ margin: '4px 0 0', color: 'var(--inv-dim)' }}>{guest.family_name}{seatCap !== null ? ` · שמורים לכם ${seatCap} מקומות` : ''}</p>}
              </div>
              <button type="button" aria-label="סגירה" onClick={onClose} className="sheet-x">×</button>
            </div>

            <fieldset style={{ border: 0, padding: 0, margin: '16px 0 0' }}>
              <legend className="sr-only">מגיעים?</legend>
              <div className="seg" data-testid="rsvp-status">
                {STATUSES.map((s) => (
                  <button key={s.key} type="button" aria-pressed={status === s.key} onClick={() => { setStatus(s.key); setBad((b) => ({ ...b, status: undefined, count: undefined })); }}>{s.label}</button>
                ))}
              </div>
              {bad.status && <p role="alert" className="sheet-hint">{bad.status}</p>}
            </fieldset>

            {status && status !== 'declined' && (
              <div className="sheet-count" data-testid="rsvp-count">
                <Stepper label="מבוגרים" value={adults} set={setAdults} max={adults + Math.max(0, roomSeats)} />
                <Stepper label="ילדים" value={children} set={setChildren} max={children + Math.max(0, roomSeats)} />
                <Stepper label="תינוקות" hint="ללא כיסא" value={babies} set={setBabies} max={seatCap !== null ? 10 : babies + Math.max(0, roomSeats)} />
                {bad.count && <p role="alert" className="sheet-hint">{bad.count}</p>}
              </div>
            )}

            <label className="sheet-row"><span className="sheet-label">שם מלא</span>
              <input ref={first} className="sheet-field" name="name" autoComplete="name" autoCapitalize="words" enterKeyHint="next" maxLength={80} placeholder="למשל: משפחת כהן" aria-invalid={!!bad.name} aria-describedby={bad.name ? 'rsvp-name-err' : undefined}
                value={name} onChange={(e) => { setName(e.target.value); if (bad.name) setBad((b) => ({ ...b, name: undefined })); }} onKeyDown={enter(() => phoneRef.current?.focus())} required />
              {bad.name && <span id="rsvp-name-err" role="alert" className="sheet-hint">{bad.name}</span>}</label>

            <label className="sheet-row"><span className="sheet-label">טלפון נייד <span style={{ fontWeight: 400, opacity: .8 }}>(לא חובה)</span></span>
              <input ref={phoneRef} className="sheet-field" name="phone" type="tel" inputMode="tel" autoComplete="tel" enterKeyHint="done" dir="ltr" style={{ textAlign: 'right' }} maxLength={20} placeholder="050-1234567" aria-invalid={!!bad.phone} aria-describedby={bad.phone ? 'rsvp-phone-err' : undefined}
                value={phone} onChange={(e) => { setPhone(e.target.value.replace(/[^\d+\-\s()]/g, '')); if (bad.phone) setBad((b) => ({ ...b, phone: undefined })); }} onKeyDown={enter()} />
              {bad.phone && <span id="rsvp-phone-err" role="alert" className="sheet-hint">{bad.phone}</span>}</label>

            {status !== 'declined' && (
              <div className="sheet-row" role="group" aria-label="העדפות מיוחדות" data-testid="rsvp-prefs">
                <span className="sheet-label">העדפות מיוחדות <span style={{ fontWeight: 400, opacity: .8 }}>(לא חובה)</span></span>
                <div className="sheet-chips">
                  {PREFS.map((p) => <button key={p} type="button" aria-pressed={picked.includes(p)} onClick={() => togglePref(p)}>{p}</button>)}
                </div>
                <input className="sheet-field" style={{ marginTop: 8 }} name="preferences" aria-label="העדפה אחרת" autoComplete="off" enterKeyHint="done" maxLength={300} placeholder="משהו אחר? כתבו כאן" value={other} onChange={(e) => setOther(e.target.value)} onKeyDown={enter()} />
              </div>
            )}

            {more ? (
              <label className="sheet-row"><span className="sheet-label">הערות לבעלי האירוע</span>
                <textarea className="sheet-field" name="notes" autoComplete="off" rows={2} maxLength={500} autoFocus={!notes} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
            ) : <button type="button" className="sheet-add" onClick={() => setMore(true)}>+ הוספת הערה</button>}

            {error && <p role="alert" className="sheet-error">{error}</p>}
            <div className="sheet-foot">
              <button type="submit" className="inv-btn" disabled={busy} data-testid="rsvp-send">
                {busy ? 'שומרים…' : `${answered ? 'עדכון התשובה' : 'שליחת התשובה'}${status && status !== 'declined' && total > 0 ? ` · ${total} משתתפים` : ''}`}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useDialogFocus } from '@/lib/dialog';
import type { GuestStatus } from '@/lib/types';
import { STATUS_LABEL } from '@/lib/types';

export function StatusPill({ status }: { status: GuestStatus }) {
  return <span className={`pill pill-${status}`}>{STATUS_LABEL[status]}</span>;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  useDialogFocus(box);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
        className={`max-h-[94dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'}`}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-display text-xl font-medium">{title}</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="סגירה">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

type Toast = { id: number; text: string; bad?: boolean };
const ToastCtx = createContext<(text: string, bad?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, bad?: boolean) => {
    const id = Date.now() + Math.random();
    setItems((l) => [...l, { id, text, bad }]);
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), bad ? 6000 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="no-print pointer-events-none fixed inset-x-0 bottom-4 z-[80] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} role={t.bad ? 'alert' : 'status'}
            className={`rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-lg ${t.bad ? 'bg-no' : 'bg-ink'}`}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="card px-6 py-10 text-center">
      <p className="font-display text-lg">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

export const fmtDateTime = (iso: string | null) => iso
  ? new Intl.DateTimeFormat('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' }).format(new Date(iso)) : '';

export function dbError(e: { message?: string; code?: string } | null): string {
  const m = e?.message ?? '';
  if (m.includes('TABLE_FULL')) return 'אין מספיק מקומות פנויים בשולחן הזה.';
  if (m.includes('guests_event_phone_uq')) return 'מספר הטלפון כבר רשום אצל משפחה אחרת באירוע.';
  if (e?.code === '23505') return 'הערך כבר קיים במערכת.';
  if (e?.code === '42501' || m.includes('row-level security')) return 'אין לך הרשאה לפעולה הזו.';
  return 'הפעולה נכשלה. נסו שוב.';
}

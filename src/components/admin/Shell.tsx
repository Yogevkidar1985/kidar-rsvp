'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useEvent } from './EventContext';
import { Icon, type IconName } from './icons';
import { useDialogFocus } from '@/lib/dialog';

type Item = { href: string; label: string; short?: string; icon: IconName; owner?: boolean };
const GROUPS: { title: string; items: Item[] }[] = [
  { title: 'האירוע', items: [
    { href: '', label: 'סקירה', icon: 'overview' },
    { href: '/guests', label: 'מוזמנים', icon: 'guests' },
    { href: '/tables', label: 'סידורי הושבה', short: 'הושבה', icon: 'tables' },
  ] },
  { title: 'ההזמנה', items: [
    { href: '/editor', label: 'עיצוב ההזמנה', short: 'עיצוב', icon: 'design' },
    { href: '/whatsapp', label: 'הזמנות WhatsApp', short: 'הזמנות', icon: 'message' },
    { href: '/reminders', label: 'תזכורות', icon: 'bell' },
  ] },
  { title: 'ניהול', items: [
    { href: '/export', label: 'ייצוא לאקסל', icon: 'download' },
    { href: '/connections', label: 'התראות וחיבורים', icon: 'link', owner: true },
    { href: '/team', label: 'צוות והרשאות', icon: 'shield', owner: true },
  ] },
];
/** What a phone keeps one tap away; everything else sits behind "עוד". */
const BAR = ['', '/guests', '/whatsapp', '/editor'];

export default function Shell({ children }: { children: React.ReactNode }) {
  const { event, isOwner } = useEvent();
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const drawer = useRef<HTMLDivElement>(null);
  useDialogFocus(drawer, open);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);
  const base = `/admin/events/${event.id}`;
  useEffect(() => { setOpen(false); }, [path]);
  async function signOut() { await supabaseBrowser().auth.signOut(); router.replace('/admin/login'); router.refresh(); }
  const isActive = (href: string) => (href === '' ? path === base : path.startsWith(base + href));
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((n) => !n.owner || isOwner) })).filter((g) => g.items.length);
  const all = groups.flatMap((g) => g.items);
  const status = event.published
    ? <span className="inline-flex items-center gap-1.5 text-ok"><i className="size-1.5 rounded-full bg-ok" />ההזמנה פורסמה</span>
    : <span className="inline-flex items-center gap-1.5 text-warn"><i className="size-1.5 rounded-full bg-warn" />טיוטה, לא פורסמה</span>;

  const nav = (
    <nav className="grid gap-5" aria-label="ניווט באירוע">
      {groups.map((g) => (
        <div key={g.title}>
          <div className="mb-1 px-2.5 text-[11px] font-semibold tracking-wide text-muted">{g.title}</div>
          <div className="grid gap-0.5">
            {g.items.map((n) => (
              <Link key={n.href} href={base + n.href} aria-current={isActive(n.href) ? 'page' : undefined}
                className={`nav-item ${isActive(n.href) ? 'is-active' : ''}`}>
                <Icon name={n.icon} />{n.label}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
  const foot = (
    <div className="grid gap-0.5 border-t border-line pt-3">
      <Link href="/admin?all=1" className="nav-item"><Icon name="list" />כל האירועים</Link>
      <button type="button" onClick={signOut} className="nav-item text-start"><Icon name="logout" />יציאה</button>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[236px_1fr]">
      {/* desktop: a quiet sidebar */}
      <aside className="no-print sticky top-0 hidden h-dvh flex-col border-e border-line bg-white px-3 py-4 lg:flex">
        <div className="px-2.5 pb-4 text-[15px] font-bold tracking-tight text-ink">KIDAR RSVP</div>
        <div className="mb-5 rounded-xl border border-line bg-paper px-3 py-2.5">
          <div className="truncate text-sm font-semibold leading-snug">{event.name}</div>
          <div className="mt-1 text-xs font-medium">{status}</div>
        </div>
        <div className="flex-1 overflow-y-auto">{nav}</div>
        {foot}
      </aside>

      {/* phone: a slim header, and the main places in a bar under the thumb */}
      <header className="no-print sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-line bg-white/95 px-4 py-2.5 backdrop-blur lg:hidden">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold leading-tight">{event.name}</div>
          <div className="text-xs font-medium">{status}</div>
        </div>
        <span className="flex-none text-xs font-bold tracking-tight text-muted">KIDAR RSVP</span>
      </header>

      <main className="min-w-0 px-4 pb-28 pt-5 sm:px-8 lg:pb-10 lg:pt-8">
        <div className="mx-auto max-w-[1180px]">{children}</div>
      </main>

      <nav className="no-print fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="ניווט ראשי">
        {BAR.map((h) => all.find((n) => n.href === h)).filter((n): n is Item => !!n).map((n) => (
          <Link key={n.href} href={base + n.href} aria-current={isActive(n.href) ? 'page' : undefined} className={`tab-item ${isActive(n.href) ? 'is-active' : ''}`}>
            <Icon name={n.icon} size={21} /><span>{n.short ?? n.label}</span>
          </Link>
        ))}
        <button type="button" className={`tab-item ${open || !BAR.some(isActive) ? 'is-active' : ''}`} aria-expanded={open} onClick={() => setOpen(true)}>
          <Icon name="more" size={21} /><span>עוד</span>
        </button>
      </nav>
      {open && (
        <div className="overlay no-print fixed inset-0 z-50 flex items-end bg-text/40 lg:hidden" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div ref={drawer} tabIndex={-1} role="dialog" aria-modal="true" aria-label="תפריט" className="max-h-[86dvh] w-full overflow-y-auto rounded-t-2xl bg-white px-3 pb-[calc(16px+env(safe-area-inset-bottom))] pt-3">
            <div className="mb-3 flex items-center justify-between px-2.5">
              <span className="text-[15px] font-semibold">תפריט</span>
              <button type="button" className="btn btn-ghost btn-icon" aria-label="סגירה" onClick={() => setOpen(false)}><Icon name="close" /></button>
            </div>
            {nav}
            <div className="mt-4">{foot}</div>
          </div>
        </div>
      )}
    </div>
  );
}

export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="no-print mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 lg:mb-6">
      <div className="min-w-0">
        <h1 className="page-title">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

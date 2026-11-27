'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useEvent } from './EventContext';

const NAV = [
  { href: '', label: 'סקירה' }, { href: '/guests', label: 'מוזמנים' }, { href: '/tables', label: 'שולחנות' },
  { href: '/editor', label: 'עיצוב ההזמנה' }, { href: '/export', label: 'ייצוא' },
  { href: '/connections', label: 'התראות וחיבורים', owner: true }, { href: '/team', label: 'צוות והרשאות', owner: true },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const { event, isOwner } = useEvent();
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const base = `/admin/events/${event.id}`;
  async function signOut() { await supabaseBrowser().auth.signOut(); router.replace('/admin/login'); router.refresh(); }
  const links = NAV.filter((n) => !n.owner || isOwner).map((n) => {
    const href = base + n.href, active = n.href === '' ? path === base : path.startsWith(href);
    return (
      <Link key={n.href} href={href} onClick={() => setOpen(false)} aria-current={active ? 'page' : undefined}
        className={`block rounded-lg px-3 py-2.5 text-[15px] font-semibold transition-colors ${active ? 'bg-white/12 text-white' : 'text-white/70 hover:bg-white/8 hover:text-white'}`}>
        {n.label}
      </Link>
    );
  });
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[250px_1fr]">
      <header className="no-print sticky top-0 z-40 flex items-center justify-between bg-ink px-4 py-3 text-white lg:hidden">
        <span className="font-display text-lg">KIDAR RSVP</span>
        <button type="button" className="rounded-lg border border-white/25 px-3 py-1.5 text-sm font-semibold" aria-expanded={open} onClick={() => setOpen(!open)}>תפריט</button>
      </header>
      <aside className={`no-print bg-ink text-white lg:sticky lg:top-0 lg:block lg:h-dvh lg:overflow-y-auto ${open ? 'block' : 'hidden'}`}>
        <div className="flex h-full flex-col p-4">
          <div className="hidden px-3 pb-5 pt-2 lg:block">
            <div className="font-display text-2xl">KIDAR RSVP</div>
            <div className="mt-0.5 text-xs text-white/55">גרסה 2.0</div>
          </div>
          <div className="mb-3 rounded-xl bg-white/8 px-3 py-3">
            <div className="text-xs text-white/55">האירוע</div>
            <div className="mt-0.5 font-semibold leading-snug">{event.name}</div>
            <div className="mt-1 text-xs">{event.published ? <span className="text-emerald-300">ההזמנה פורסמה</span> : <span className="text-amber-300">ההזמנה עדיין לא פורסמה</span>}</div>
          </div>
          <nav className="grid gap-1" aria-label="ניווט באירוע">{links}</nav>
          <div className="mt-auto grid gap-1 pt-6">
            <Link href="/admin?all=1" className="rounded-lg px-3 py-2 text-sm text-white/70 hover:bg-white/8 hover:text-white">כל האירועים</Link>
            <button type="button" onClick={signOut} className="rounded-lg px-3 py-2 text-start text-sm text-white/70 hover:bg-white/8 hover:text-white">יציאה מהמערכת</button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 px-4 py-6 sm:px-8 lg:py-8">{children}</main>
    </div>
  );
}

export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="no-print mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-[28px] font-medium leading-tight">{title}</h1>
        {sub && <p className="mt-1 text-muted">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

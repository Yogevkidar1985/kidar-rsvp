'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { EventRow, Guest, Role, TableRow } from '@/lib/types';
import { dbError, useToast } from './ui';

type Ctx = {
  event: EventRow; setEvent: (e: EventRow) => void;
  guests: Guest[]; tables: TableRow[]; role: Role; canEdit: boolean; isOwner: boolean;
  reload: () => Promise<void>;
  /** Saves a change to one family and notifies the owners when status, head-count or arrival changed. */
  updateGuest: (id: string, patch: Partial<Guest>) => Promise<boolean>;
};
const EventCtx = createContext<Ctx | null>(null);
export function useEvent() {
  const c = useContext(EventCtx);
  if (!c) throw new Error('useEvent outside provider');
  return c;
}

export function EventProvider({ id, children }: { id: string; children: React.ReactNode }) {
  const db = supabaseBrowser();
  const toast = useToast();
  const [event, setEvent] = useState<EventRow | null>(null);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [tables, setTables] = useState<TableRow[]>([]);
  const [role, setRole] = useState<Role>('viewer');
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const guestsRef = useRef<Guest[]>([]);
  guestsRef.current = guests;

  const reload = useCallback(async () => {
    const [g, t] = await Promise.all([
      db.from('guests').select('*').eq('event_id', id).order('family_name'),
      db.from('tables').select('*').eq('event_id', id).order('created_at'),
    ]);
    if (g.data) setGuests(g.data as Guest[]);
    if (t.data) setTables(t.data as TableRow[]);
  }, [db, id]);

  useEffect(() => {
    let live = true;
    (async () => {
      const { data: { user } } = await db.auth.getUser();
      const [ev, mem] = await Promise.all([
        db.from('events').select('*').eq('id', id).maybeSingle(),
        user ? db.from('event_members').select('role').eq('event_id', id).eq('user_id', user.id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      if (!live) return;
      if (!ev.data) { setState('missing'); return; }
      setEvent(ev.data as EventRow);
      setRole(((mem.data as { role: Role } | null)?.role) ?? 'viewer');
      await reload();
      if (live) setState('ready');
    })();
    const ch = db.channel(`event-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'guests', filter: `event_id=eq.${id}` }, () => { void reload(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tables', filter: `event_id=eq.${id}` }, () => { void reload(); })
      .subscribe();
    const poll = setInterval(() => { if (!document.hidden) void reload(); }, 30000);
    return () => { live = false; clearInterval(poll); void db.removeChannel(ch); };
  }, [db, id, reload]);

  const updateGuest = useCallback(async (gid: string, patch: Partial<Guest>) => {
    const prev = guestsRef.current.find((g) => g.id === gid);
    if (!prev) return false;
    const { data, error } = await db.from('guests').update(patch).eq('id', gid).select('*').maybeSingle();
    if (error || !data) { toast(dbError(error), true); return false; }
    const next = data as Guest;
    setGuests((l) => l.map((g) => (g.id === gid ? next : g)));
    const kind = next.arrived && !prev.arrived ? 'arrived'
      : next.status !== prev.status ? 'status_change'
      : next.adults !== prev.adults || next.children !== prev.children || next.babies !== prev.babies ? 'count_change' : null;
    if (kind) {
      void fetch('/api/admin/notify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guestId: gid, kind, previous: { status: prev.status, adults: prev.adults, children: prev.children, babies: prev.babies } }),
      }).catch(() => {});
    }
    return true;
  }, [db, toast]);

  const value = useMemo(() => event && {
    event, setEvent, guests, tables, role, canEdit: role !== 'viewer', isOwner: role === 'owner', reload, updateGuest,
  }, [event, guests, tables, role, reload, updateGuest]);

  if (state === 'loading') return <div className="mx-auto max-w-[1180px] p-6"><div className="grid gap-3" aria-busy="true" aria-label="טוענים"><div className="skeleton h-9 w-48" /><div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><div className="skeleton h-24" /><div className="skeleton h-24" /><div className="skeleton h-24" /><div className="skeleton h-24" /></div><div className="skeleton h-56" /></div></div>;
  if (state === 'missing' || !value) {
    return <div className="p-10 text-center"><p className="font-display text-xl">האירוע לא נמצא</p><p className="mt-2 text-muted">ייתכן שאין לך הרשאה לצפות בו. <a className="underline" href="/admin">חזרה לרשימת האירועים</a></p></div>;
  }
  return <EventCtx.Provider value={value}>{children}</EventCtx.Provider>;
}

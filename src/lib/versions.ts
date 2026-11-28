/** Shared by the versions API and the screens that use it. No secrets ever pass through here. */
export type Seating = {
  tables: { id: string; name: string; capacity: number; pos_x: number; pos_y: number; shape: string }[];
  seats: { g: string; t: string }[];
};
export type Version = { id: number; kind: 'event' | 'seating'; auto: boolean; at: string; label: string; summary: string };
export type Archived = { log: number; id: string; at: string; why: 'deleted' | 'merged'; into: string | null; family_name: string; phone: string | null; status: string; people: number };

/** A restore never moves these: the address guests already hold, and whether the invitation is public. */
export const EVENT_KEEP = ['id', 'slug', 'published', 'created_at', 'updated_at'];

/** What a family record is rebuilt from. */
export const GUEST_COLUMNS = ['id', 'family_name', 'contact_name', 'phone', 'allocated_seats', 'adults', 'children', 'babies', 'status', 'responded_at', 'arrived', 'arrived_count', 'arrived_at',
  'table_id', 'notes', 'preferences', 'admin_notes', 'is_vip', 'group_name', 'invite_token', 'link_code', 'source', 'created_at', 'invited_at', 'reminders_enabled', 'opted_out'];

export const seatingSummary = (s: Seating) => `${s.tables.length} שולחנות · ${s.seats.length} משפחות משובצות`;

async function call<T>(body: unknown): Promise<T & { ok: boolean; message?: string }> {
  try {
    const r = await fetch('/api/admin/versions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return await r.json();
  } catch { return { ok: false, message: 'אין חיבור לשרת.' } as T & { ok: boolean; message?: string }; }
}
export const versions = {
  list: async (eventId: string, kind: 'event' | 'seating'): Promise<Version[]> => {
    try { const j = await (await fetch(`/api/admin/versions?event=${eventId}&kind=${kind}`, { cache: 'no-store' })).json(); return j.ok ? j.versions : []; } catch { return []; }
  },
  get: async (eventId: string, id: number): Promise<{ id: number; kind: string; at: string; label: string; data: Record<string, unknown> } | null> => {
    try { const j = await (await fetch(`/api/admin/versions?event=${eventId}&id=${id}`, { cache: 'no-store' })).json(); return j.ok ? j.version : null; } catch { return null; }
  },
  archive: async (eventId: string): Promise<Archived[]> => {
    try { const j = await (await fetch(`/api/admin/versions?event=${eventId}&archive=1`, { cache: 'no-store' })).json(); return j.ok ? j.guests : []; } catch { return []; }
  },
  snapshot: (eventId: string, kind: 'event' | 'seating', label: string, auto = true) => call<{ id?: number; fresh?: boolean }>({ action: 'snapshot', eventId, kind, label, auto }),
  restore: (eventId: string, id: number) => call<{ kind?: string; before?: number; seated?: number; skipped?: number; event?: Record<string, unknown> }>({ action: 'restore', eventId, id }),
  remove: (eventId: string, id: number) => call({ action: 'remove', eventId, id }),
  deleteGuest: (eventId: string, guestId: string) => call({ action: 'delete_guest', eventId, guestId }),
  restoreGuest: (eventId: string, guestId: string) => call({ action: 'restore_guest', eventId, guestId }),
  importFile: (eventId: string, backup: unknown, parts: ('event' | 'guests')[]) => call<{ event?: boolean; added?: number; skipped?: number }>({ action: 'import', eventId, backup, parts }),
};

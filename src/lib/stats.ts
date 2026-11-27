import type { Guest, TableRow } from './types';

/** Chairs a family needs. Babies do not take a chair. Mirrors public.guest_seats. */
export function seats(g: Pick<Guest, 'status' | 'adults' | 'children' | 'allocated_seats'>): number {
  if (g.status === 'declined') return 0;
  if (g.status === 'attending') return g.adults + g.children;
  if (g.status === 'maybe' && g.adults + g.children > 0) return g.adults + g.children;
  return g.allocated_seats ?? 0;
}
/** People a family was invited for: the allocation, else what they reported, else 1. */
export const invited = (g: Guest) => g.allocated_seats ?? Math.max(1, g.adults + g.children + g.babies);

export function computeStats(guests: Guest[]) {
  const by = (s: Guest['status']) => guests.filter((g) => g.status === s);
  const att = by('attending'), maybe = by('maybe'), dec = by('declined'), pen = by('pending');
  const sum = (a: Guest[], f: (g: Guest) => number) => a.reduce((n, g) => n + f(g), 0);
  const people = (g: Guest) => g.adults + g.children + g.babies;
  const responded = guests.length - pen.length;
  return {
    families: guests.length,
    invitedTotal: sum(guests, invited),
    attendingPeople: sum(att, people),
    attendingFamilies: att.length,
    maybePeople: sum(maybe, (g) => Math.max(people(g), 0)), maybeFamilies: maybe.length,
    declinedPeople: sum(dec, invited), declinedFamilies: dec.length,
    pendingPeople: sum(pen, invited), pendingFamilies: pen.length,
    responseRate: guests.length ? Math.round((responded / guests.length) * 100) : 0,
    adults: sum(att, (g) => g.adults), children: sum(att, (g) => g.children), babies: sum(att, (g) => g.babies),
    allocatedSeats: sum(guests, (g) => g.allocated_seats ?? 0),
    confirmedSeats: sum(att, (g) => g.adults + g.children),
    arrivedFamilies: guests.filter((g) => g.arrived).length,
    arrivedPeople: sum(guests.filter((g) => g.arrived), (g) => g.arrived_count ?? people(g)),
  };
}
export type Stats = ReturnType<typeof computeStats>;

export function tableLoad(table: TableRow, guests: Guest[]) {
  const here = guests.filter((g) => g.table_id === table.id);
  const used = here.reduce((n, g) => n + seats(g), 0);
  return { guests: here, used, free: table.capacity - used, over: used > table.capacity };
}

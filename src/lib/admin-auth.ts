import 'server-only';
import { supabaseServer } from './supabase/server';
import type { Role } from './types';

/** The signed-in user's role in an event, read under their own RLS. Null when signed out or not a member. */
export async function roleIn(eventId: string): Promise<{ userId: string; role: Role } | null> {
  const db = await supabaseServer();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return null;
  const { data } = await db.from('event_members').select('role').eq('event_id', eventId).eq('user_id', user.id).maybeSingle();
  return data ? { userId: user.id, role: (data as { role: Role }).role } : null;
}
export const canSend = (r: Role) => r === 'editor' || r === 'owner';

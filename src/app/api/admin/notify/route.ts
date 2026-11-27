import { NextResponse, after } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { dispatch } from '@/lib/notify';

export const runtime = 'nodejs';
const schema = z.object({
  guestId: z.string().uuid(),
  kind: z.enum(['status_change', 'count_change', 'arrived']),
  previous: z.object({
    status: z.enum(['pending', 'attending', 'maybe', 'declined']).optional(),
    adults: z.number().int().optional(), children: z.number().int().optional(), babies: z.number().int().optional(),
  }).nullish(),
});

/** Called by the dashboard after an owner changes a guest. The guest is re-read under the caller's RLS. */
export async function POST(req: Request) {
  const db = await supabaseServer();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });
  const { data: g } = await db.from('guests')
    .select('event_id,family_name,contact_name,phone,status,adults,children,babies,notes,preferences,arrived,arrived_count')
    .eq('id', parsed.data.guestId).maybeSingle();
  if (!g) return NextResponse.json({ ok: false }, { status: 404 });
  const { event_id, ...snapshot } = g;
  after(() => dispatch(event_id, parsed.data.kind, snapshot, parsed.data.previous ?? null));
  return NextResponse.json({ ok: true });
}

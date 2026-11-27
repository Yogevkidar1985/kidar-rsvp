import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const schema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{2,60}$/),
  token: z.string().max(40).nullish(),
  kind: z.enum(['visit', 'rsvp_start']),
  visitor: z.string().max(40).nullish(),
});

/**
 * Called by the invitation page once it is on a real screen. A link preview or a crawler fetches the page but
 * never runs this, so an "opened" count means a person's browser. Always answers the same: it tells a caller nothing.
 */
export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (parsed.success) {
    const v = parsed.data;
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
    // an anonymous visitor is told apart by a random id kept in their browser, hashed with the address
    const visitor = createHash('sha256').update(`${process.env.RSVP_HASH_SECRET ?? ''}:${v.visitor ?? ''}:${ip}`).digest('hex').slice(0, 24);
    try { await supabaseAdmin().rpc('track_invitation', { p_slug: v.slug, p_token: v.token ?? null, p_kind: v.kind, p_visitor: visitor }); } catch { /* analytics never breaks the page */ }
  }
  return new NextResponse(null, { status: 204 });
}

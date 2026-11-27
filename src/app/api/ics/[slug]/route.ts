import { supabaseAdmin } from '@/lib/supabase/admin';
import { icsFile } from '@/lib/calendar';
import type { PublicInvitation } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The event as a calendar file. Served from an address rather than built in the page, because an iPhone offers
 * "add to calendar" for a calendar file it navigates to, and in-app browsers cannot save a file made in the page.
 * `?download=1` asks the browser to save it instead.
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9][a-z0-9-]{2,60}$/.test(slug)) return new Response(null, { status: 404 });
  const { data } = await supabaseAdmin().rpc('get_public_invitation', { p_slug: slug, p_token: null });
  const ics = data ? icsFile(data as PublicInvitation) : null;
  if (!ics) return new Response(null, { status: 404 });
  const save = new URL(req.url).searchParams.get('download') === '1';
  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `${save ? 'attachment' : 'inline'}; filename="${slug}.ics"`,
      'Cache-Control': 'no-store',
    },
  });
}

import { NextResponse, after } from 'next/server';
import { createHash } from 'node:crypto';
import { rsvpSchema, RSVP_ERRORS } from '@/lib/validation';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { dispatch } from '@/lib/notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let json: unknown;
  try { json = await req.json(); } catch { return NextResponse.json({ ok: false, message: 'בקשה לא תקינה' }, { status: 400 }); }
  const parsed = rsvpSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? 'נתונים לא תקינים' }, { status: 400 });
  }
  const v = parsed.data;
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const rlKey = createHash('sha256').update(`${process.env.RSVP_HASH_SECRET ?? ''}:${ip}`).digest('hex').slice(0, 32);

  let data: any;
  try {
    const res = await supabaseAdmin().rpc('submit_rsvp', {
      p_slug: v.slug, p_token: v.token ?? null, p_name: v.name, p_phone: v.phone, p_status: v.status,
      p_adults: v.adults, p_children: v.children, p_babies: v.babies,
      p_notes: v.notes, p_preferences: v.preferences, p_rl_key: rlKey,
    });
    if (res.error) throw res.error;
    data = res.data;
  } catch (e) {
    console.error('submit_rsvp failed', e);
    return NextResponse.json({ ok: false, message: 'לא הצלחנו לשמור את האישור. נסו שוב.' }, { status: 500 });
  }
  if (!data?.ok) {
    const code = String(data?.error ?? '');
    let message = RSVP_ERRORS[code] ?? 'לא הצלחנו לשמור את האישור.';
    if (code === 'OVER_ALLOCATION') message = `הוקצו לכם ${data.allocated} מקומות. לתוספת פנו לבעלי האירוע.`;
    return NextResponse.json({ ok: false, code, message }, { status: code === 'RATE_LIMITED' ? 429 : 422 });
  }
  if (data.changed) {
    after(() => dispatch(data.event.id, data.created ? 'rsvp_new' : 'rsvp_update', data.guest, data.previous));
  }
  const g = data.guest;
  return NextResponse.json({
    ok: true, created: data.created,
    guest: { status: g.status, adults: g.adults, children: g.children, babies: g.babies },
  });
}

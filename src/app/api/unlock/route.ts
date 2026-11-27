import { NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_TRIES = 8; // wrong codes per address in a 10-minute window
const sha = (s: string) => createHash('sha256').update(s).digest();

/** The team's shared code opens the admin: a correct code signs the browser in as the event owner. */
export async function POST(req: Request) {
  let code = '';
  try { code = String((await req.json())?.code ?? ''); } catch { /* empty code */ }
  const admin = supabaseAdmin();
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const key = 'unlock:' + sha(`${process.env.RSVP_HASH_SECRET ?? ''}:${ip}`).toString('hex').slice(0, 32);
  const now = new Date();
  now.setUTCMinutes(Math.floor(now.getUTCMinutes() / 10) * 10, 0, 0);
  const win = now.toISOString();

  const { data: row } = await admin.from('rate_limits').select('count').eq('key', key).eq('window_start', win).maybeSingle();
  const tries = row?.count ?? 0;
  if (tries >= MAX_TRIES) return NextResponse.json({ ok: false, wait: true }, { status: 429 });

  const expected = process.env.ADMIN_PASSCODE || '1007';
  if (!timingSafeEqual(sha(code), sha(expected))) {
    await admin.from('rate_limits').upsert({ key, window_start: win, count: tries + 1 });
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const { data: invite } = await admin.from('admin_invites').select('email').eq('role', 'owner')
    .order('created_at', { ascending: true }).limit(1).maybeSingle();
  const email = process.env.ADMIN_EMAIL || invite?.email;
  if (!email) return NextResponse.json({ ok: false, setup: true }, { status: 500 });

  await admin.auth.admin.createUser({ email, email_confirm: true }); // fails harmlessly when the account exists
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const token_hash = link.data?.properties?.hashed_token;
  if (link.error || !token_hash) return NextResponse.json({ ok: false, setup: true }, { status: 500 });

  const db = await supabaseServer();
  const { error } = await db.auth.verifyOtp({ token_hash, type: 'magiclink' });
  if (error) return NextResponse.json({ ok: false, setup: true }, { status: 500 });
  return NextResponse.json({ ok: true });
}

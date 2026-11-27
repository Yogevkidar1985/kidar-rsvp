import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { roleIn } from '@/lib/admin-auth';
import { greenState, greenUrl } from '@/lib/green';

export const runtime = 'nodejs';
const STATE: Record<string, string> = {
  authorized: 'מחובר, והטלפון מקושר',
  notAuthorized: 'הפרטים נכונים, אבל עוד לא נסרק קוד QR מהטלפון במסוף של Green API',
  blocked: 'החשבון חסום ב-WhatsApp', sleepMode: 'הטלפון כבוי או לא מחובר לרשת', starting: 'המופע עולה, נסו שוב בעוד דקה', yellowCard: 'WhatsApp הגביל זמנית את השליחה מהמספר',
};
const schema = z.object({ eventId: z.string().uuid(), instance: z.string().trim().regex(/^\d{6,20}$/), token: z.string().trim().regex(/^[A-Za-z0-9]{20,120}$/), url: z.string().trim().max(120).optional() });

/** Saves the Green API details of an event after checking them with Green API. Owners only. The token is never sent back. */
export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: 'מזהה המופע הוא מספר, והטוקן הוא רצף של אותיות וספרות. העתיקו אותם מהמסוף של Green API.' }, { status: 400 });
  const v = parsed.data;
  const me = await roleIn(v.eventId);
  if (!me) return NextResponse.json({ ok: false }, { status: 401 });
  if (me.role !== 'owner') return NextResponse.json({ ok: false, message: 'רק בעלי האירוע יכולים לחבר את WhatsApp.' }, { status: 403 });
  const url = greenUrl(v.url);
  if (!url) return NextResponse.json({ ok: false, message: 'כתובת ה-API צריכה להיות כתובת https של green-api.com.' }, { status: 400 });
  const st = await greenState({ instance: v.instance, token: v.token, url });
  if (!st.ok) return NextResponse.json({ ok: false, message: st.state === 'unreachable' ? 'לא הצלחנו להגיע ל-Green API. נסו שוב.' : 'Green API לא מזהה את הפרטים האלה. בדקו את מזהה המופע, הטוקן וכתובת ה-API.' }, { status: 400 });
  const { error } = await supabaseAdmin().from('event_secrets').upsert({ event_id: v.eventId, green_instance: v.instance, green_token: v.token, green_url: url, updated_at: new Date().toISOString() });
  if (error) return NextResponse.json({ ok: false, setup: true, message: 'נדרש עדכון למסד הנתונים לפני שאפשר לשמור את החיבור.' }, { status: 409 });
  return NextResponse.json({ ok: true, linked: st.state === 'authorized', message: STATE[st.state] ?? `מצב המופע: ${st.state}` });
}

/** Removes the saved connection. */
export async function DELETE(req: Request) {
  const eventId = new URL(req.url).searchParams.get('event') ?? '';
  if (!/^[0-9a-f-]{36}$/.test(eventId)) return NextResponse.json({ ok: false }, { status: 400 });
  const me = await roleIn(eventId);
  if (!me) return NextResponse.json({ ok: false }, { status: 401 });
  if (me.role !== 'owner') return NextResponse.json({ ok: false }, { status: 403 });
  await supabaseAdmin().from('event_secrets').delete().eq('event_id', eventId);
  return NextResponse.json({ ok: true });
}

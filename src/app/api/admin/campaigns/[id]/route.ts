import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { canSend, roleIn } from '@/lib/admin-auth';

export const runtime = 'nodejs';
const schema = z.object({ action: z.enum(['pause', 'resume', 'cancel', 'retry']) });

/** Pause, resume, cancel what is still waiting, or queue failed messages again. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ ok: false }, { status: 400 });
  const db = supabaseAdmin();
  const { data: c } = await db.from('campaigns').select('id,event_id,kind,status,scheduled_at').eq('id', id).maybeSingle();
  if (!c) return NextResponse.json({ ok: false }, { status: 404 });
  const me = await roleIn(c.event_id);
  if (!me) return NextResponse.json({ ok: false }, { status: 401 });
  if (!canSend(me.role)) return NextResponse.json({ ok: false }, { status: 403 });
  const now = new Date().toISOString();
  const waiting = c.kind === 'reminder' && c.scheduled_at && !(await db.from('messages').select('id', { count: 'exact', head: true }).eq('campaign_id', id)).count;
  switch (parsed.data.action) {
    case 'pause':
      await db.from('campaigns').update({ status: 'paused' }).eq('id', id).in('status', ['sending', 'scheduled']);
      break;
    case 'resume':
      await db.from('campaigns').update({ status: waiting ? 'scheduled' : 'sending' }).eq('id', id).eq('status', 'paused');
      break;
    case 'cancel':
      await db.from('messages').update({ status: 'skipped', error: 'הקמפיין בוטל' }).eq('campaign_id', id).eq('status', 'pending');
      await db.from('campaigns').update({ status: 'cancelled', finished_at: now }).eq('id', id).in('status', ['sending', 'scheduled', 'paused']);
      break;
    case 'retry':
      await db.from('messages').update({ status: 'pending', attempts: 0, error: null }).eq('campaign_id', id).eq('status', 'failed');
      await db.from('campaigns').update({ status: 'sending', finished_at: null }).eq('id', id).in('status', ['done', 'sending']);
      break;
  }
  return NextResponse.json({ ok: true });
}

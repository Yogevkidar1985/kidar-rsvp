import { NextResponse } from 'next/server';
import { runTick } from '@/lib/outbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Moves the WhatsApp queue forward. Called every minute by the database's scheduler, and by the campaign screen while it is open.
 * It takes no input and only sends what is already queued and due, so calling it more often changes nothing.
 */
async function tick() {
  try { return NextResponse.json({ ok: true, ...(await runTick()) }); }
  catch { return NextResponse.json({ ok: false }, { status: 500 }); }
}
export const GET = tick;
export const POST = tick;

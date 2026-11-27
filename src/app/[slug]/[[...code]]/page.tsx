import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { InvitationPage, guestKey, invitationMetadata } from '@/lib/invitation-page';

// The short address of an invitation: /<event> for everyone, /<event>/<code> for one guest.
export const dynamic = 'force-dynamic';
type Params = { params: Promise<{ slug: string; code?: string[] }>; searchParams: Promise<{ test?: string }> };
const keyOf = (code?: string[]) => (!code?.length ? null : code.length === 1 ? guestKey(code[0]) : undefined);

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const p = await params;
  return invitationMetadata(p.slug, keyOf(p.code) ?? null);
}
export default async function Page({ params, searchParams }: Params) {
  const p = await params, key = keyOf(p.code);
  if (key === undefined) notFound(); // more path than an invitation has
  return <InvitationPage slug={p.slug} guest={key} test={(await searchParams).test === '1'} />;
}

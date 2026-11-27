import type { Metadata } from 'next';
import { InvitationPage, guestKey, invitationMetadata } from '@/lib/invitation-page';

// The original address of an invitation: /e/<event>?g=<guest>. Links already sent keep working here.
export const dynamic = 'force-dynamic';
type Params = { params: Promise<{ slug: string }>; searchParams: Promise<{ g?: string; test?: string }> };

export async function generateMetadata({ params, searchParams }: Params): Promise<Metadata> {
  return invitationMetadata((await params).slug, guestKey((await searchParams).g));
}
export default async function Page({ params, searchParams }: Params) {
  const q = await searchParams;
  return <InvitationPage slug={(await params).slug} guest={guestKey(q.g)} test={q.test === '1'} />;
}

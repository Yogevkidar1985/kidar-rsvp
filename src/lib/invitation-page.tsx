import 'server-only';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { PublicInvitation } from '@/lib/types';
import InvitationView from '@/components/invitation/InvitationView';

/** Names the site itself uses: an event can never be reached under one of them. */
const RESERVED = new Set(['admin', 'api', 'auth', 'e', 'i']);

const load = cache(async (slug: string, token: string | null): Promise<PublicInvitation | null> => {
  if (!/^[a-z0-9][a-z0-9-]{2,60}$/.test(slug) || RESERVED.has(slug)) return null;
  const { data, error } = await supabaseAdmin().rpc('get_public_invitation', { p_slug: slug, p_token: token });
  if (error) throw new Error('invitation lookup failed');
  return (data as PublicInvitation | null) ?? null;
});
/** A guest's key: the long token of older links, or the short code of new ones. Anything else is ignored. */
export const guestKey = (g?: string | null) => (g && (/^[a-f0-9]{18}$/.test(g) || /^[A-Za-z0-9]{8}$/.test(g)) ? g : null);

export async function invitationMetadata(slug: string, key: string | null): Promise<Metadata> {
  const data = await load(slug, key);
  if (!data) return { title: 'הזמנה' };
  const description = [data.headline, data.weekday_label, data.hebrew_date].filter(Boolean).join(' · ');
  return {
    title: data.name, description, robots: { index: false, follow: false },
    openGraph: { title: data.name, description, images: data.hero_url ? [data.hero_url] : [] },
  };
}

export async function InvitationPage({ slug, guest, test }: { slug: string; guest: string | null; test: boolean }) {
  const data = await load(slug, guest);
  if (!data) notFound();
  return <InvitationView data={data} token={data.guest ? guest : null} test={test} />;
}

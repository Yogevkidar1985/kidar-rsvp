import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { PublicInvitation } from '@/lib/types';
import InvitationView from '@/components/invitation/InvitationView';

export const dynamic = 'force-dynamic';
type Params = { params: Promise<{ slug: string }>; searchParams: Promise<{ g?: string }> };

const load = cache(async (slug: string, token: string | null): Promise<PublicInvitation | null> => {
  if (!/^[a-z0-9][a-z0-9-]{2,60}$/.test(slug)) return null;
  const { data, error } = await supabaseAdmin().rpc('get_public_invitation', { p_slug: slug, p_token: token });
  if (error) throw new Error('invitation lookup failed');
  return (data as PublicInvitation | null) ?? null;
});
const tokenOf = (g?: string) => (g && /^[a-f0-9]{18}$/.test(g) ? g : null);

export async function generateMetadata({ params, searchParams }: Params): Promise<Metadata> {
  const data = await load((await params).slug, tokenOf((await searchParams).g));
  if (!data) return { title: 'הזמנה' };
  const description = [data.headline, data.weekday_label, data.hebrew_date].filter(Boolean).join(' · ');
  return {
    title: data.name, description, robots: { index: false, follow: false },
    openGraph: { title: data.name, description, images: data.hero_url ? [data.hero_url] : [] },
  };
}

export default async function InvitationPage({ params, searchParams }: Params) {
  const token = tokenOf((await searchParams).g);
  const data = await load((await params).slug, token);
  if (!data) notFound();
  return <InvitationView data={data} token={data.guest ? token : null} />;
}

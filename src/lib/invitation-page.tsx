import 'server-only';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { PublicInvitation } from '@/lib/types';
import InvitationView from '@/components/invitation/InvitationView';

/** Names the site itself uses: an event can never be reached under one of them. */
import { LINK_CODE } from './links';
import { resolveDesign } from './defaults';
const RESERVED = new Set(['admin', 'api', 'auth', 'e', 'i', 'og', 'fonts']);

const load = cache(async (slug: string, token: string | null): Promise<PublicInvitation | null> => {
  if (!/^[a-z0-9][a-z0-9-]{2,60}$/.test(slug) || RESERVED.has(slug)) return null;
  const { data, error } = await supabaseAdmin().rpc('get_public_invitation', { p_slug: slug, p_token: token });
  if (error) throw new Error('invitation lookup failed');
  return (data as PublicInvitation | null) ?? null;
});
/** A guest's key: the long token of older links, the short code of new ones, or a word the owner chose. Anything else is ignored. */
export const guestKey = (g?: string | null) => (g && (/^[a-f0-9]{18}$/.test(g) || LINK_CODE.test(g)) ? g : null);

export async function invitationMetadata(slug: string, key: string | null): Promise<Metadata> {
  const data = await load(slug, key);
  if (!data) return { title: 'הזמנה' };
  const share = resolveDesign(data.design).share;
  const description = share.description || [data.headline, data.weekday_label, data.hebrew_date, data.reception_time || data.ceremony_time].filter(Boolean).join(' · ');
  // the preview picture must be an absolute address: built from the configured site, or from the host that was asked
  const h = await headers();
  const origin = (process.env.NEXT_PUBLIC_SITE_URL || `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('x-forwarded-host') ?? h.get('host') ?? ''}`).replace(/\/+$/, '');
  const k = 0.7; // the picture carries a photograph, so it is drawn smaller to stay light
  const image = { url: `${origin}/og/${data.slug}`, width: Math.round(1200 * k), height: Math.round(630 * k), alt: data.name };
  return {
    title: data.name, description, robots: { index: false, follow: false },
    openGraph: { title: share.title || (data.hosts ? `${data.hosts} · ${data.name}` : data.name), description, images: [image], locale: 'he_IL', type: 'website' },
    twitter: { card: 'summary_large_image', images: [image.url] },
  };
}

export async function InvitationPage({ slug, guest, test }: { slug: string; guest: string | null; test: boolean }) {
  const data = await load(slug, guest);
  if (!data) notFound();
  return <InvitationView data={data} token={data.guest ? guest : null} test={test} />;
}

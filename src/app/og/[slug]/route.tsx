import { ImageResponse } from 'next/og';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { DEFAULT_HERO, resolveDesign } from '@/lib/defaults';
import { dateParts } from '@/lib/hebrew-date';
import { safeHttpUrl } from '@/lib/validation';
import type { PublicInvitation } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The picture a messaging app shows next to the invitation link: names, date and time in the invitation's own colours.
 * It carries nothing personal to a guest, so every guest's link shares one image.
 */
let fonts: Promise<{ light: ArrayBuffer; medium: ArrayBuffer }> | null = null;
const loadFonts = (origin: string) => (fonts ??= Promise.all(['Light', 'Medium'].map(async (w) => {
  const r = await fetch(`${origin}/fonts/Heebo-${w}.ttf`);
  if (!r.ok) throw new Error('font');
  return r.arrayBuffer();
})).then(([light, medium]) => ({ light, medium })).catch((e) => { fonts = null; throw e; }));

/** The renderer lays text out left to right only. Hebrew is handed over in visual order: runs reversed, letters of Hebrew runs reversed. */
function visual(s: string): string {
  const runs = s.match(/[֐-׿׳״״׳"']+|[0-9A-Za-z:./&-]+|\s+|[^\s]/g) ?? [];
  return runs.reverse().map((r) => (/[֐-׿]/.test(r) ? [...r].reverse().join('') : r)).join('');
}

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9][a-z0-9-]{2,60}$/.test(slug)) return new Response(null, { status: 404 });
  const { data } = await supabaseAdmin().rpc('get_public_invitation', { p_slug: slug, p_token: null });
  const ev = data as PublicInvitation | null;
  if (!ev) return new Response(null, { status: 404 });

  const d = resolveDesign(ev.design);
  const c = d.colors;
  const date = dateParts(ev.event_date);
  const time = ev.reception_time || ev.ceremony_time;
  const hero = safeHttpUrl(ev.hero_url) ?? `${new URL(req.url).origin}${DEFAULT_HERO}`;
  const line2 = [ev.weekday_label, ev.hebrew_date].filter(Boolean).join(' – ');
  const f = await loadFonts(new URL(req.url).origin);
  // with a photograph the picture is drawn smaller: a PNG of a photo grows fast, and messaging apps skip heavy previews
  const k = hero ? 0.7 : 1, n = (x: number) => Math.round(x * k);
  const W = n(1200), H = n(630), textW = hero ? n(700) : W;

  return new ImageResponse(
    (
      <div style={{ width: W, height: H, display: 'flex', background: c.surface, color: c.ink, fontFamily: 'Heebo' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {hero && <img src={hero} alt="" width={W - textW} height={H} style={{ objectFit: 'cover' }} />}
        <div style={{ width: textW, height: H, display: 'flex', padding: n(18) }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: `1.5px solid ${c.line}`, padding: `0 ${n(22)}px` }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: n(18) }}>
              <div style={{ width: n(70), height: 1.5, background: c.accent }} />
              <div style={{ width: n(11), height: n(11), background: c.accent, transform: 'rotate(45deg)', margin: `0 ${n(16)}px` }} />
              <div style={{ width: n(70), height: 1.5, background: c.accent }} />
            </div>
            {d.latin ? <div style={{ fontSize: n(23), letterSpacing: n(6), color: c.muted, marginBottom: n(10) }}>{d.latin.toUpperCase()}</div> : null}
            {ev.hosts ? <div style={{ fontSize: n(hero ? 70 : 78), fontWeight: 500, lineHeight: 1.15, textAlign: 'center' }}>{visual(ev.hosts)}</div> : null}
            <div style={{ fontSize: n(40), fontWeight: 500, color: c.muted, marginTop: n(8), textAlign: 'center' }}>{visual(ev.headline || ev.name)}</div>
            <div style={{ width: n(320), height: 1.5, background: c.line, margin: `${n(22)}px 0 ${n(22)}px` }} />
            {date ? <div style={{ fontSize: n(hero ? 78 : 86), fontWeight: 500, letterSpacing: n(2), lineHeight: 1 }}>{date.numeric}</div> : null}
            {line2 ? <div style={{ fontSize: n(34), fontWeight: 500, color: c.muted, marginTop: n(12) }}>{visual(line2)}</div> : null}
            {time ? <div style={{ fontSize: n(46), fontWeight: 500, marginTop: n(8), letterSpacing: n(1) }}>{time}</div> : null}
          </div>
        </div>
      </div>
    ),
    {
      width: W, height: H,
      fonts: [{ name: 'Heebo', data: f.light, weight: 300, style: 'normal' }, { name: 'Heebo', data: f.medium, weight: 500, style: 'normal' }],
      headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300' },
    },
  );
}

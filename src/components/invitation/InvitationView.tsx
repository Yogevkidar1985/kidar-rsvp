'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { PublicInvitation, TextStyle } from '@/lib/types';
import { DEFAULT_HERO, resolveDesign } from '@/lib/defaults';
import { fontStack, fontsHref } from '@/lib/fonts';
import { dateParts } from '@/lib/hebrew-date';
import { googleCalendarUrl } from '@/lib/calendar';
import { intlPhone } from '@/lib/phone';
import { safeHttpUrl } from '@/lib/validation';
import Particles from './Particles';
import RsvpSheet, { type Answer, type RsvpResult } from './RsvpSheet';
import { useDialogFocus } from '@/lib/dialog';
import { eventStart } from '@/lib/when';
import { ornamentLottie, sparkleLottie } from './lotties';

const Lottie = dynamic(() => import('lottie-react'), { ssr: false });

type Props = {
  data: PublicInvitation; token?: string | null;
  /** editor preview: no RSVP submission, no fixed elements */
  preview?: boolean;
  /** bump to replay the celebration (editor) */
  celebrateKey?: number;
  /** test mode: the whole journey works, nothing is saved or counted */
  test?: boolean;
};

const css = (s: TextStyle): React.CSSProperties => ({
  fontFamily: fontStack(s.font), fontSize: s.size, fontWeight: s.weight, letterSpacing: `${s.spacing}em`,
  lineHeight: s.lineHeight, textAlign: s.align, color: s.color, margin: 0,
});

function Reveal({ on, children, delay = 0 }: { on: boolean; children: React.ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!on || !ref.current) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { threshold: 0.15 });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [on]);
  if (!on) return <div>{children}</div>;
  return <div ref={ref} className={`reveal${seen ? ' in' : ''}`} style={{ transitionDelay: `${delay}ms` }}>{children}</div>;
}

function youtubeId(u: string): string | null {
  const m = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/.exec(u);
  return m ? m[1] : null;
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useDialogFocus(box);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="sheet-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} tabIndex={-1} className="sheet" role="dialog" aria-modal="true" aria-label={title} dir="rtl">
        <h2 className="sheet-title">{title}</h2>
        <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>{children}</div>
        <button type="button" className="inv-btn ghost" style={{ marginTop: 10 }} onClick={onClose}>סגירה</button>
      </div>
    </div>
  );
}

const ICONS: Record<string, React.ReactNode> = {
  phone: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18M12 14v4M10 16h4" /></>,
  navigation: <path d="m3 11 19-9-9 19-2-8-8-2z" />,
  pin: <><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" /></>,
  clock: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>,
  share: <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98" /></>,
  link: <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>,
  down: <path d="m6 9 6 6 6-6" />,
  chat: <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />,
  facebook: <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />,
  copy: <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
  map: <><path d="M14.1 5.9 9.9 3.8a2 2 0 0 0-1.8 0L3.6 6A1 1 0 0 0 3 6.9v12.5a1 1 0 0 0 1.4.9l3.7-1.9a2 2 0 0 1 1.8 0l4.2 2.1a2 2 0 0 0 1.8 0l4.5-2.2a1 1 0 0 0 .6-.9V4.9a1 1 0 0 0-1.4-.9l-3.7 1.9a2 2 0 0 1-1.8 0z" /><path d="M9 3.8v15M15 5.8v15" /></>,
  compass: <><circle cx="12" cy="12" r="10" /><path d="m16.2 7.8-2.1 6.3-6.3 2.1 2.1-6.3z" /></>,
  save: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></>,
};
/** Line icons, one family (the Lucide / Feather outline set), drawn in the text colour. */
const Icon = ({ name, size = 22 }: { name: keyof typeof ICONS; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]}</svg>
);
const Ornament = () => (
  <div className="inv-orn" aria-hidden="true"><i /><svg width="9" height="9" viewBox="0 0 9 9"><path d="M4.5 0 9 4.5 4.5 9 0 4.5z" fill="currentColor" /></svg><i /></div>
);
/** Days, hours and minutes left. Renders nothing once the event has begun, or before the clock is known on the client. */
function Countdown({ to }: { to: Date }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { setNow(Date.now()); const id = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(id); }, []);
  if (now === null) return null;
  const left = to.getTime() - now;
  if (left <= 0) return null;
  const days = Math.floor(left / 86400000), hours = Math.floor((left % 86400000) / 3600000), minutes = Math.floor((left % 3600000) / 60000);
  const cells = days > 0 ? [[days, 'ימים'], [hours, 'שעות'], [minutes, 'דקות']] : [[hours, 'שעות'], [minutes, 'דקות']];
  return (
    <div className="inv-count" role="timer" aria-label={`נותרו ${days} ימים, ${hours} שעות ו-${minutes} דקות`}>
      {cells.map(([n, l]) => <div key={l as string}><b>{n}</b><span>{l}</span></div>)}
    </div>
  );
}
const OPTIONS: { key: Answer; label: string }[] = [
  { key: 'attending', label: 'מגיעים' }, { key: 'maybe', label: 'עדיין לא בטוחים' }, { key: 'declined', label: 'לא מגיעים' },
];
const ANSWERED: Record<Answer, string> = { attending: 'אישרתם הגעה', maybe: 'רשמנו שאתם עדיין לא בטוחים', declined: 'עדכנתם שלא תגיעו' };

export default function InvitationView({ data, token = null, preview = false, celebrateKey = 0, test = false }: Props) {
  const d = useMemo(() => resolveDesign(data.design), [data.design]);
  const [guest, setGuest] = useState(data.guest);
  const [sheet, setSheet] = useState<null | 'rsvp' | 'cal' | 'nav' | 'share' | 'contact'>(null);
  const [pick, setPick] = useState<Answer | null>(null);
  const [mine, setMine] = useState<RsvpResult | null>(null);
  const [burst, setBurst] = useState(0);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [sticky, setSticky] = useState(false);
  const [note, setNote] = useState('');
  const touch = useRef(0);
  const [origin, setOrigin] = useState({ top: 0, height: 0 });
  const heroRef = useRef<HTMLDivElement>(null);
  const driftRef = useRef<HTMLDivElement>(null);
  const rsvpRef = useRef<HTMLElement>(null);
  const lightRef = useRef<HTMLDivElement>(null);
  useDialogFocus(lightRef, lightbox !== null);
  useEffect(() => {
    if (lightbox === null) return;
    const n = data.media.length;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null);
      else if (e.key === 'ArrowLeft' && n > 1) setLightbox((i) => (i === null ? i : (i + 1) % n));
      else if (e.key === 'ArrowRight' && n > 1) setLightbox((i) => (i === null ? i : (i + n - 1) % n));
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [lightbox, data.media.length]);

  useEffect(() => { setGuest(data.guest); }, [data.guest]);
  useEffect(() => { if (celebrateKey) setBurst((n) => n + 1); }, [celebrateKey]);
  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const measure = () => setOrigin({ top: el.offsetTop, height: el.offsetHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data.hero_pos?.ratio, d.heroShape]);
  // the floating button shows once the hero is behind the reader, and steps aside at the RSVP section
  useEffect(() => {
    if (preview || !rsvpRef.current || !heroRef.current) return;
    let pastHero = false, atRsvp = false;
    const io = new IntersectionObserver((list) => {
      for (const e of list) {
        if (e.target === heroRef.current) pastHero = !e.isIntersecting && e.boundingClientRect.top < 0;
        else atRsvp = e.isIntersecting;
      }
      setSticky(pastHero && !atRsvp);
    }, { threshold: 0.05 });
    io.observe(heroRef.current); io.observe(rsvpRef.current);
    return () => io.disconnect();
  }, [preview]);
  // a slow drift of the photograph while it scrolls past
  useEffect(() => {
    if (preview || !d.entrance || !data.hero_url) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    const move = () => { raf = 0; const el = driftRef.current; if (el) el.style.transform = `translate3d(0, ${Math.min(window.scrollY, 900) * 0.06}px, 0)`; };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(move); };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [preview, d.entrance, data.hero_url]);

  // tell the dashboard that a person opened the invitation, and later that they began to answer
  const track = useCallback((kind: 'visit' | 'rsvp_start') => {
    if (preview || test) return;
    try {
      const once = `kidar:${kind}:${data.slug}:${token ?? ''}`;
      if (kind === 'rsvp_start' && sessionStorage.getItem(once)) return;
      sessionStorage.setItem(once, '1');
      let visitor = localStorage.getItem('kidar:visitor');
      if (!visitor) { visitor = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('kidar:visitor', visitor); }
      void fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: data.slug, token, kind, visitor }), keepalive: true }).catch(() => {});
    } catch { /* storage is blocked: the visit simply is not counted */ }
  }, [preview, test, data.slug, token]);
  useEffect(() => { track('visit'); }, [track]);
  const closeSheet = useCallback(() => setSheet(null), []);
  const onSaved = useCallback((r: RsvpResult) => {
    setMine(r);
    setGuest((g) => (g ? { ...g, ...r } : g));
    if (r.status === 'attending' && d.celebrate.enabled) setBurst((n) => n + 1);
  }, [d.celebrate.enabled]);
  const flash = (t: string) => { setNote(t); window.setTimeout(() => setNote(''), 2200); };
  // What a guest passes on is the event's general link, never their own: a personal link lets its holder answer in the guest's name.
  const [shareUrl, setShareUrl] = useState('');
  useEffect(() => { setShareUrl(`${window.location.origin}/${data.slug}`); }, [data.slug]);
  const shareText = [data.name, data.weekday_label, dateParts(data.event_date)?.numeric, data.reception_time || data.ceremony_time].filter(Boolean).join(' · ');
  async function copyLink() {
    try { await navigator.clipboard.writeText(shareUrl); flash('הקישור הועתק'); } catch { flash('לא הצלחנו להעתיק את הקישור'); }
  }
  async function nativeShare() {
    try { await navigator.share({ title: data.name, text: shareText, url: shareUrl }); } catch { /* the guest closed the share sheet */ }
  }
  const openRsvp = (a: Answer | null) => { if (preview) return; track('rsvp_start'); setPick(a); setSheet('rsvp'); };

  const date = dateParts(data.event_date);
  const place = [data.venue_name, data.address].filter(Boolean).join(', ');
  const waze = safeHttpUrl(data.waze_url) ?? (place ? `https://waze.com/ul?q=${encodeURIComponent(place)}&navigate=yes` : null);
  const gmaps = safeHttpUrl(data.gmaps_url) ?? (place ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}` : null);
  const gcal = googleCalendarUrl(data);
  const amaps = place ? `https://maps.apple.com/?daddr=${encodeURIComponent(place)}` : null;
  const hostWa = data.contact_phone ? intlPhone(data.contact_phone) : null;
  const tel = data.contact_phone?.replace(/[^\d+]/g, '');
  const hero = safeHttpUrl(data.hero_url) ?? DEFAULT_HERO;
  const pos = Object.assign({ x: 50, y: 50, zoom: 1, ratio: '4/5', brightness: 1, contrast: 1, overlay: 0 }, data.hero_pos);
  const gallery = data.media.filter((m) => m.kind === 'gallery');
  const venue = data.media.filter((m) => m.kind === 'venue');
  const video = safeHttpUrl(data.video_url);
  const yt = video ? youtubeId(video) : null;
  const rsvpOpen = data.rsvp_settings?.open !== false;
  const status: Answer | null = mine?.status ?? (guest && guest.status !== 'pending' ? (guest.status as Answer) : null);
  const fonts = fontsHref([d.font]);
  const vars = {
    '--inv-bg': d.colors.bg, '--inv-surface': d.colors.surface, '--inv-soft': d.colors.soft, '--inv-ink': d.colors.ink, '--inv-muted': d.colors.muted,
    '--inv-accent': d.colors.accent, '--inv-button': d.colors.button, '--inv-button-text': d.colors.buttonText,
    '--inv-line': d.colors.line, '--inv-font': fontStack(d.font), '--inv-gap': `${Math.round(64 * d.spacing)}px`,
    '--inv-radius': d.corners === 'sharp' ? '2px' : d.corners === 'pill' ? '999px' : '10px',
  } as React.CSSProperties;
  const burstColors = useMemo(() => [...d.fall.colors.filter((c) => c.toUpperCase() !== '#FFFFFF'), d.colors.accent, d.colors.button], [d.fall.colors, d.colors.accent, d.colors.button]);
  const body = css(d.styles.body);
  const dateStyle = css(d.styles.date);
  const anim = d.entrance;
  const times = [
    data.reception_time && { t: data.reception_time, l: 'קבלת פנים' },
    data.ceremony_time && { t: data.ceremony_time, l: 'טקס' },
  ].filter(Boolean) as { t: string; l: string }[];
  const shots = [...gallery, ...venue];
  const start = useMemo(() => eventStart(data), [data]);
  const [calm, setCalm] = useState(true); // until the client says motion is welcome, nothing extra moves
  useEffect(() => { setCalm(window.matchMedia('(prefers-reduced-motion: reduce)').matches); }, []);
  const lively = anim && d.extras.sparkle && !calm;
  const sparkle = useMemo(() => sparkleLottie(d.colors.accent, d.colors.line), [d.colors.accent, d.colors.line]);
  const ornament = useMemo(() => ornamentLottie(d.colors.accent), [d.colors.accent]);
  const hasPlace = !!(data.venue_name || data.address || venue.length || data.directions || data.parking || data.extra_info);

  const photos = (list: typeof gallery, cls: string) => (
    <div className={cls}>
      {list.map((m) => (
        <button key={m.id} type="button" onClick={() => !preview && setLightbox(shots.findIndex((x) => x.id === m.id))} aria-label={m.caption || 'הגדלת התמונה'}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={m.url} alt={m.caption ?? ''} loading="lazy" decoding="async" />
        </button>
      ))}
    </div>
  );

  return (
    <div className="inv" style={vars} dir="rtl">
      {fonts && <link rel="stylesheet" href={fonts} />}
      {test && <div className="inv-test" role="status">מצב בדיקה · תשובה שתישלח מכאן לא נשמרת ולא נספרת</div>}
      <div className={`inv-col${anim ? ' inv-load' : ''}`}>
        {d.fall.enabled && origin.height > 0 && (
          <Particles mode="fall" kind={d.fall.kind} count={d.fall.count} colors={d.fall.colors} speed={d.fall.speed}
            intensity={d.fall.intensity} duration={d.fall.duration} originY={origin.top}
            style={{ position: 'absolute', top: 0, insetInline: 0, width: '100%', height: origin.top + origin.height + 300, zIndex: 5 }} />
        )}

        <div ref={heroRef} className={hero || preview ? `inv-hero ${d.heroShape}` : 'inv-hero-none'} style={hero || preview ? { aspectRatio: pos.ratio } : undefined}>
          {hero ? (
            <div className={anim ? 'inv-kenburns' : ''} style={{ position: 'absolute', inset: 0 }}>
              <div ref={driftRef} className="inv-drift">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={hero} alt={data.name} fetchPriority="high" decoding="async"
                  style={{ objectPosition: `${pos.x}% ${pos.y}%`, transform: `scale(${pos.zoom})`, transformOrigin: `${pos.x}% ${pos.y}%`, filter: `brightness(${pos.brightness}) contrast(${pos.contrast})` }} />
              </div>
              {pos.overlay > 0 && <div className="inv-veil" style={{ opacity: pos.overlay }} />}
            </div>
          ) : (
            <div className="inv-hero-empty">{preview ? 'כאן תופיע התמונה הראשית. מעלים אותה בלשונית "תמונות".' : ''}</div>
          )}
          {hero && <span className="inv-scroll" aria-hidden="true"><Icon name="down" size={26} /></span>}
        </div>

        <main className="inv-body">
          <header className="inv-open">
            <Reveal on={anim}>
              <div className="inv-crest">
                {lively && <Lottie className="inv-sparkle" animationData={sparkle} loop={3} aria-hidden="true" />}
                {d.latin && <p className="inv-latin" dir="ltr" lang="en">{d.latin}</p>}
                {data.hosts && <p className="inv-names" style={css(d.styles.hosts)}>{data.hosts}</p>}
                {data.name && <p className="inv-kicker">{data.name}</p>}
              </div>
              {lively ? <Lottie className="inv-orn-draw" animationData={ornament} loop={false} aria-hidden="true" /> : <Ornament />}
            </Reveal>
          </header>

          <section className="inv-sec inv-first">
            {guest && <Reveal on={anim}><p className="inv-dear">{guest.family_name} היקרים</p></Reveal>}
            {data.headline && <Reveal on={anim}><h1 style={css(d.styles.headline)}>{data.headline}</h1></Reveal>}
            {data.intro_text && <Reveal on={anim} delay={50}><p style={{ ...body, marginTop: 20, whiteSpace: 'pre-line' }}>{data.intro_text}</p></Reveal>}
            {(data.closing_text || data.hosts) && (
              <Reveal on={anim} delay={100}>
                {data.closing_text && <p style={{ ...body, marginTop: 24, whiteSpace: 'pre-line' }}>{data.closing_text}</p>}
                {data.hosts && <p style={{ ...body, fontWeight: 500 }}>{data.hosts}</p>}
              </Reveal>
            )}
          </section>

          {(date || data.hebrew_date || times.length > 0) && (
            <section className="inv-sec">
              <Reveal on={anim}>
                <div className="inv-when" style={dateStyle}>
                  {date && <div className="inv-datenum" dir="ltr">{date.numeric}</div>}
                  {(data.weekday_label || data.hebrew_date) && <div className="inv-dateline">{[data.weekday_label, data.hebrew_date].filter(Boolean).join(' – ')}</div>}
                  {times.length > 0 && (
                    <div className="inv-times">
                      {times.map((x) => <div key={x.l}><Icon name="clock" size={18} /><b dir="ltr">{x.t}</b>{times.length > 1 && <small>{x.l}</small>}</div>)}
                    </div>
                  )}
                </div>
                {d.extras.countdown && start && <Countdown to={start} />}
              </Reveal>
            </section>
          )}

          <section className={`inv-sec ${hasPlace ? 'inv-band' : 'inv-plain'}`}>
            <Reveal on={anim}>
              {(data.venue_name || data.address) && (
                <>
                  <span className="inv-pin"><Icon name="pin" size={24} /></span>
                  {data.venue_name && <p style={css(d.styles.hosts)}>{data.venue_name}</p>}
                  {data.address && <p style={{ ...body, marginTop: 2 }}>{data.address}</p>}
                </>
              )}
              {venue.length > 0 && photos(venue, 'inv-venue')}
              <div className="inv-quick" data-testid="actions">
                {d.buttons.navigate && (waze || gmaps) && <button type="button" onClick={() => !preview && setSheet('nav')}><Icon name="navigation" /><span>{d.labels.navigate}</span></button>}
                {d.buttons.calendar && gcal && <button type="button" onClick={() => !preview && setSheet('cal')}><Icon name="calendar" /><span>{d.labels.calendar}</span></button>}
                {d.buttons.call && tel && <button type="button" onClick={() => !preview && setSheet('contact')}><Icon name="phone" /><span>יצירת קשר</span></button>}
                <button type="button" onClick={() => !preview && setSheet('share')}><Icon name="share" /><span>שיתוף</span></button>
              </div>
              {(data.directions || data.parking || data.extra_info) && (
                <dl className="inv-notes">
                  {data.directions && <div><dt>הוראות הגעה</dt><dd>{data.directions}</dd></div>}
                  {data.parking && <div><dt>חניה</dt><dd>{data.parking}</dd></div>}
                  {data.extra_info && <div><dt>כדאי לדעת</dt><dd>{data.extra_info}</dd></div>}
                </dl>
              )}
            </Reveal>
          </section>

          {(gallery.length > 0 || video) && (
            <section className="inv-sec">
              {gallery.length > 0 && <Reveal on={anim}>{photos(gallery, 'inv-gallery')}</Reveal>}
              {video && (
                <Reveal on={anim}>
                  <div className="inv-video">
                    {yt ? <iframe title="סרטון" src={`https://www.youtube-nocookie.com/embed/${yt}`} loading="lazy" allowFullScreen />
                      : <video src={video} controls playsInline preload="metadata" />}
                  </div>
                </Reveal>
              )}
            </section>
          )}

          <section ref={rsvpRef} className="inv-sec inv-rsvp" id="rsvp">
            <Reveal on={anim}>
              <Ornament />
              <h2 style={{ ...css(d.styles.headline), fontSize: d.styles.headline.size * 0.74 }}>{d.labels.rsvpTitle}</h2>
              {!rsvpOpen ? <p style={{ ...body, marginTop: 14 }}>אישורי ההגעה נסגרו</p> : status ? (
                <>
                  <p style={{ ...body, marginTop: 14 }}>{ANSWERED[status]}{status !== 'declined' && mine ? ` · ${mine.adults + mine.children + mine.babies} משתתפים` : ''}</p>
                  <button type="button" className="inv-btn ghost" style={{ marginTop: 20 }} data-testid="rsvp-open" onClick={() => openRsvp(status)}>עדכון התשובה</button>
                </>
              ) : (
                <>
                  <p style={{ ...body, marginTop: 10, color: 'var(--inv-dim)', fontSize: Math.round(d.styles.body.size * 0.9) }}>נשמח לדעת אם תגיעו</p>
                  <div className="inv-options">
                    {OPTIONS.map((o, i) => (
                      <button key={o.key} type="button" className={`inv-btn${i ? ' ghost' : ''}`} data-testid={i ? undefined : 'rsvp-open'} onClick={() => openRsvp(o.key)}>{o.label}</button>
                    ))}
                  </div>
                </>
              )}
            </Reveal>
          </section>
        </main>
      </div>

      {!preview && rsvpOpen && (
        <div className={`inv-sticky${sticky && !sheet ? ' show' : ''}`}>
          <button type="button" className="inv-btn" tabIndex={sticky ? 0 : -1} onClick={() => rsvpRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>{status ? 'עדכון אישור ההגעה' : d.labels.rsvp}</button>
        </div>
      )}
      {sheet === 'rsvp' && (
        <RsvpSheet slug={data.slug} token={token} guest={guest} initial={pick} maxParty={data.rsvp_settings?.max_party ?? 15}
          accent={d.colors.accent} test={test} onClose={closeSheet} onSaved={onSaved} />
      )}
      {sheet === 'nav' && (
        <Sheet title="ניווט לאירוע" onClose={closeSheet}>
          {place && <p className="sheet-sub">{place}</p>}
          <div className="inv-choices">
            {waze && <a href={waze} target="_blank" rel="noopener noreferrer"><Icon name="navigation" /><span>Waze</span></a>}
            {gmaps && <a href={gmaps} target="_blank" rel="noopener noreferrer"><Icon name="pin" /><span>Google Maps</span></a>}
            {amaps && <a href={amaps} target="_blank" rel="noopener noreferrer"><Icon name="map" /><span>מפות Apple</span></a>}
          </div>
        </Sheet>
      )}
      {sheet === 'cal' && (
        <Sheet title="הוספה ליומן" onClose={closeSheet}>
          <p className="sheet-sub">בחרו את היומן שאליו תרצו להוסיף את האירוע</p>
          <div className="inv-rows">
            <a href={`/api/ics/${data.slug}`}><Icon name="calendar" /><span>Apple Calendar<small>iPhone / iPad / Mac</small></span></a>
            {gcal && <a href={gcal} target="_blank" rel="noopener noreferrer"><Icon name="calendar" /><span>Google Calendar<small>Android / iPhone</small></span></a>}
            <a href={`/api/ics/${data.slug}?download=1`} download><Icon name="save" /><span>הורדת קובץ יומן<small>Outlook ויומנים אחרים (‎.ics)</small></span></a>
          </div>
          <p className="sheet-note">אם היומן לא נפתח מתוך WhatsApp או אפליקציה אחרת, פתחו את ההזמנה ב-Safari באייפון או ב-Chrome באנדרואיד ונסו שוב. אחרי שהאירוע נפתח צריך לאשר את השמירה ביומן.</p>
        </Sheet>
      )}
      {sheet === 'share' && (
        <Sheet title="שיתוף ההזמנה" onClose={closeSheet}>
          <div className="inv-choices">
            <a href={`https://wa.me/?text=${encodeURIComponent(`${shareText}\n${shareUrl}`)}`} target="_blank" rel="noopener noreferrer"><Icon name="chat" /><span>WhatsApp</span></a>
            <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noopener noreferrer"><Icon name="facebook" /><span>Facebook</span></a>
            <button type="button" onClick={copyLink}><Icon name="copy" /><span>העתקה</span></button>
            {typeof navigator !== 'undefined' && 'share' in navigator && <button type="button" onClick={nativeShare}><Icon name="share" /><span>עוד</span></button>}
          </div>
          <p className="sheet-note">נשלח הקישור הכללי של האירוע. מי שיקבל אותו ימלא את הפרטים שלו בעצמו.</p>
        </Sheet>
      )}
      {sheet === 'contact' && tel && (
        <Sheet title="יצירת קשר" onClose={closeSheet}>
          <p className="sheet-sub">שאלה על האירוע? אפשר לפנות ישירות</p>
          <div className="inv-rows">
            <a href={`tel:${tel}`}><Icon name="phone" /><span>חיוג<small dir="ltr">{data.contact_phone}</small></span></a>
            {hostWa && <a href={`https://wa.me/${hostWa}`} target="_blank" rel="noopener noreferrer"><Icon name="chat" /><span>הודעת WhatsApp<small>נפתחת שיחה עם המארחים</small></span></a>}
          </div>
        </Sheet>
      )}
      {note && <div className="inv-toast" role="status">{note}</div>}
      {lightbox !== null && shots[lightbox] && (
        <div ref={lightRef} tabIndex={-1} className="inv-light" onClick={() => setLightbox(null)} role="dialog" aria-modal="true" aria-label="תמונה מוגדלת"
          onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
          onTouchEnd={(e) => { const dx = e.changedTouches[0].clientX - touch.current; if (Math.abs(dx) > 50 && shots.length > 1) { e.preventDefault(); setLightbox((lightbox + (dx > 0 ? 1 : shots.length - 1)) % shots.length); } }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shots[lightbox].url} alt={shots[lightbox].caption ?? ''} />
          {shots.length > 1 && (
            <div className="inv-light-nav" onClick={(e) => e.stopPropagation()}>
              <button type="button" aria-label="התמונה הקודמת" onClick={() => setLightbox((lightbox + shots.length - 1) % shots.length)}>‹</button>
              <span dir="ltr">{lightbox + 1} / {shots.length}</span>
              <button type="button" aria-label="התמונה הבאה" onClick={() => setLightbox((lightbox + 1) % shots.length)}>›</button>
            </div>
          )}
          <button type="button" className="inv-light-x" aria-label="סגירה" onClick={() => setLightbox(null)}>×</button>
        </div>
      )}
      {burst > 0 && (
        <Particles key={burst} mode="burst" kind={d.celebrate.kind} count={d.celebrate.count} duration={d.celebrate.duration}
          colors={burstColors}
          onDone={() => setBurst(0)}
          style={{ position: preview ? 'absolute' : 'fixed', inset: 0, width: '100%', height: '100%', zIndex: 70 }} />
      )}
    </div>
  );
}

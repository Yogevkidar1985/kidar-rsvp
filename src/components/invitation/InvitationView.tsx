'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PublicInvitation, TextStyle } from '@/lib/types';
import { resolveDesign } from '@/lib/defaults';
import { fontStack, fontsHref } from '@/lib/fonts';
import { dateParts } from '@/lib/hebrew-date';
import { googleCalendarUrl, icsFile } from '@/lib/calendar';
import { safeHttpUrl } from '@/lib/validation';
import Particles from './Particles';
import RsvpSheet, { type RsvpResult } from './RsvpSheet';

type Props = {
  data: PublicInvitation; token?: string | null;
  /** editor preview: no RSVP submission, no fixed elements */
  preview?: boolean;
  /** bump to replay the celebration (editor) */
  celebrateKey?: number;
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
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="sheet-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} dir="rtl">
        <h2 style={{ font: '500 24px/1.2 "Frank Ruhl Libre", serif', margin: '0 0 14px' }}>{title}</h2>
        <div style={{ display: 'grid', gap: 10 }}>{children}</div>
        <button type="button" className="inv-chip" style={{ width: '100%', justifyContent: 'center', marginTop: 14, color: '#1e2a44' }} onClick={onClose}>סגירה</button>
      </div>
    </div>
  );
}
const sheetLink: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 52, borderRadius: 14, background: '#1e2a44', color: '#fff', fontWeight: 700, textDecoration: 'none', border: 0, width: '100%', fontSize: 16, fontFamily: 'inherit' };

export default function InvitationView({ data, token = null, preview = false, celebrateKey = 0 }: Props) {
  const d = useMemo(() => resolveDesign(data.design), [data.design]);
  const [guest, setGuest] = useState(data.guest);
  const [sheet, setSheet] = useState<null | 'rsvp' | 'nav' | 'cal'>(null);
  const [burst, setBurst] = useState(0);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [sticky, setSticky] = useState(false);
  const [origin, setOrigin] = useState({ top: 0, height: 0 });
  const heroRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLButtonElement>(null);

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
  useEffect(() => {
    if (preview || !ctaRef.current) return;
    const io = new IntersectionObserver(([e]) => setSticky(!e.isIntersecting && e.boundingClientRect.top < 0));
    io.observe(ctaRef.current);
    return () => io.disconnect();
  }, [preview]);

  const closeSheet = useCallback(() => setSheet(null), []);
  const onSaved = useCallback((r: RsvpResult) => {
    setGuest((g) => (g ? { ...g, ...r } : g));
    if (r.status === 'attending' && d.celebrate.enabled) setBurst((n) => n + 1);
  }, [d.celebrate.enabled]);

  const date = dateParts(data.event_date);
  const place = [data.venue_name, data.address].filter(Boolean).join(', ');
  const waze = safeHttpUrl(data.waze_url) ?? (place ? `https://waze.com/ul?q=${encodeURIComponent(place)}&navigate=yes` : null);
  const gmaps = safeHttpUrl(data.gmaps_url) ?? (place ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}` : null);
  const gcal = googleCalendarUrl(data);
  const tel = data.contact_phone?.replace(/[^\d+]/g, '');
  const hero = safeHttpUrl(data.hero_url);
  const pos = Object.assign({ x: 50, y: 50, zoom: 1, ratio: '4/5' }, data.hero_pos);
  const gallery = data.media.filter((m) => m.kind === 'gallery');
  const venue = data.media.filter((m) => m.kind === 'venue');
  const video = safeHttpUrl(data.video_url);
  const yt = video ? youtubeId(video) : null;
  const rsvpOpen = data.rsvp_settings?.open !== false;
  const answered = guest && guest.status !== 'pending';
  const fonts = fontsHref([d.styles.headline.font, d.styles.hosts.font, d.styles.body.font, d.styles.date.font]);
  const vars = {
    '--inv-bg': d.colors.bg, '--inv-surface': d.colors.surface, '--inv-ink': d.colors.ink, '--inv-muted': d.colors.muted,
    '--inv-accent': d.colors.accent, '--inv-button': d.colors.button, '--inv-button-text': d.colors.buttonText,
  } as React.CSSProperties;
  const burstColors = useMemo(() => [...d.fall.colors.filter((c) => c.toUpperCase() !== '#FFFFFF'), d.colors.accent, d.colors.button, '#F2C94C'], [d.fall.colors, d.colors.accent, d.colors.button]);
  const body = css(d.styles.body);
  const anim = d.entrance;

  function downloadIcs() {
    const ics = icsFile(data);
    if (!ics) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    a.download = 'event.ics'; document.body.appendChild(a); a.click(); a.remove();
  }
  const photos = (list: typeof gallery) => (
    <div className="inv-gallery">
      {list.map((m) => (
        <button key={m.id} type="button" onClick={() => !preview && setLightbox(m.url)} aria-label={m.caption || 'הגדלת התמונה'}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={m.url} alt={m.caption ?? ''} loading="lazy" />
        </button>
      ))}
    </div>
  );

  return (
    <div className="inv" style={vars} dir="rtl">
      {fonts && <link rel="stylesheet" href={fonts} />}
      <div className={`inv-col${anim ? ' inv-load' : ''}`}>
        {d.fall.enabled && origin.height > 0 && (
          <Particles mode="fall" kind={d.fall.kind} count={d.fall.count} colors={d.fall.colors} speed={d.fall.speed}
            intensity={d.fall.intensity} duration={d.fall.duration} originY={origin.top}
            style={{ position: 'absolute', top: 0, insetInline: 0, width: '100%', height: origin.top + origin.height + 300, zIndex: 5 }} />
        )}

        <div ref={heroRef} className={`inv-hero ${d.heroShape}`} style={{ aspectRatio: pos.ratio }}>
          {hero ? (
            <div className={anim ? 'inv-kenburns' : ''} style={{ position: 'absolute', inset: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={hero} alt={data.name} fetchPriority="high"
                style={{ objectPosition: `${pos.x}% ${pos.y}%`, transform: `scale(${pos.zoom})`, transformOrigin: `${pos.x}% ${pos.y}%` }} />
            </div>
          ) : (
            <div className="inv-hero-empty">{preview ? 'כאן תופיע התמונה הראשית. מעלים אותה בלשונית "תמונות".' : ''}</div>
          )}
        </div>

        <main className="inv-body">
          {guest && <Reveal on={anim}><p style={{ ...body, color: d.colors.accent, fontWeight: 600, marginBottom: 14 }}>{guest.family_name} היקרים</p></Reveal>}
          {data.headline && <Reveal on={anim}><h1 style={css(d.styles.headline)}>{data.headline}</h1></Reveal>}
          {data.intro_text && <Reveal on={anim} delay={80}><p style={{ ...body, marginTop: 16, whiteSpace: 'pre-line' }}>{data.intro_text}</p></Reveal>}

          {(date || data.hebrew_date) && (
            <Reveal on={anim}>
              <hr className="inv-rule" />
              <div style={css(d.styles.date)}>
                {date ? (
                  <div className="inv-date">
                    <span>{data.weekday_label}</span>
                    <div><div className="inv-daynum">{date.day}</div><div>{date.month} {date.year}</div></div>
                    <span>{data.reception_time || data.ceremony_time}</span>
                  </div>
                ) : <div>{data.weekday_label}</div>}
                {data.hebrew_date && <div style={{ marginTop: 14, fontSize: '0.92em' }}>{data.hebrew_date}</div>}
                {data.reception_time && data.ceremony_time && (
                  <div className="inv-times">
                    <div><b>{data.reception_time}</b><span style={{ fontSize: '0.75em' }}>קבלת פנים</span></div>
                    <div><b>{data.ceremony_time}</b><span style={{ fontSize: '0.75em' }}>טקס</span></div>
                  </div>
                )}
              </div>
            </Reveal>
          )}

          {(place || tel) && (
            <Reveal on={anim}>
              <hr className="inv-rule" />
              {data.venue_name && <p style={{ ...css(d.styles.hosts), fontSize: d.styles.hosts.size * 0.86 }}>{data.venue_name}</p>}
              {data.address && <p style={{ ...body, marginTop: 4 }}>{data.address}</p>}
              <div className="inv-actions">
                {d.buttons.navigate && (waze || gmaps) && <button type="button" className="inv-chip" onClick={() => setSheet('nav')}>{d.labels.navigate}</button>}
                {d.buttons.calendar && gcal && <button type="button" className="inv-chip" onClick={() => setSheet('cal')}>{d.labels.calendar}</button>}
                {d.buttons.call && tel && <a className="inv-chip" href={`tel:${tel}`}>{d.labels.call}</a>}
              </div>
            </Reveal>
          )}

          <Reveal on={anim}>
            {rsvpOpen ? (
              <button ref={ctaRef} type="button" className="inv-cta" data-testid="rsvp-open" onClick={() => !preview && setSheet('rsvp')}>
                {answered ? 'עדכון אישור ההגעה' : d.labels.rsvp}
              </button>
            ) : <p style={{ ...body, marginTop: 28, fontWeight: 600 }}>אישורי ההגעה נסגרו</p>}
            {answered && <p style={{ ...body, fontSize: 15, marginTop: 10 }}>התשובה שלכם נשמרה. אפשר לעדכן אותה כאן.</p>}
          </Reveal>

          {gallery.length > 0 && <Reveal on={anim}><hr className="inv-rule" />{photos(gallery)}</Reveal>}
          {video && (
            <Reveal on={anim}>
              <div style={{ marginTop: 16, borderRadius: 14, overflow: 'hidden', aspectRatio: '16/9', background: '#000' }}>
                {yt ? <iframe title="סרטון" src={`https://www.youtube-nocookie.com/embed/${yt}`} loading="lazy" allowFullScreen style={{ width: '100%', height: '100%', border: 0 }} />
                  : <video src={video} controls playsInline preload="metadata" style={{ width: '100%', height: '100%' }} />}
              </div>
            </Reveal>
          )}
          {(venue.length > 0 || data.directions || data.parking || data.extra_info) && (
            <Reveal on={anim}>
              <hr className="inv-rule" />
              {venue.length > 0 && photos(venue)}
              {data.directions && <div className="inv-info"><h3>הוראות הגעה</h3><p>{data.directions}</p></div>}
              {data.parking && <div className="inv-info"><h3>חניה</h3><p>{data.parking}</p></div>}
              {data.extra_info && <div className="inv-info"><h3>כדאי לדעת</h3><p>{data.extra_info}</p></div>}
            </Reveal>
          )}

          {(data.closing_text || data.hosts) && (
            <Reveal on={anim}>
              <hr className="inv-rule" />
              {data.closing_text && <p style={{ ...body, whiteSpace: 'pre-line' }}>{data.closing_text}</p>}
              {data.hosts && <p style={{ ...css(d.styles.hosts), marginTop: 10 }}>{data.hosts}</p>}
            </Reveal>
          )}
        </main>
      </div>

      {!preview && rsvpOpen && (
        <div className={`inv-sticky${sticky && !sheet ? ' show' : ''}`}>
          <button type="button" className="inv-cta" tabIndex={sticky ? 0 : -1} onClick={() => setSheet('rsvp')}>{answered ? 'עדכון אישור ההגעה' : d.labels.rsvp}</button>
        </div>
      )}
      {sheet === 'rsvp' && (
        <RsvpSheet slug={data.slug} token={token} guest={guest} maxParty={data.rsvp_settings?.max_party ?? 15}
          accent="#2F7D5B" onClose={closeSheet} onSaved={onSaved} />
      )}
      {sheet === 'nav' && (
        <Sheet title="ניווט לאירוע" onClose={closeSheet}>
          {waze && <a style={sheetLink} href={waze} target="_blank" rel="noopener noreferrer">Waze</a>}
          {gmaps && <a style={sheetLink} href={gmaps} target="_blank" rel="noopener noreferrer">Google Maps</a>}
        </Sheet>
      )}
      {sheet === 'cal' && (
        <Sheet title="הוספה ליומן" onClose={closeSheet}>
          {gcal && <a style={sheetLink} href={gcal} target="_blank" rel="noopener noreferrer">Google Calendar</a>}
          <button type="button" style={sheetLink} onClick={downloadIcs}>Apple Calendar / Outlook</button>
        </Sheet>
      )}
      {lightbox && (
        <div className="sheet-back" style={{ alignItems: 'center', background: 'rgb(10 14 26 / .92)' }} onClick={() => setLightbox(null)} role="dialog" aria-label="תמונה מוגדלת">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="" style={{ maxWidth: '94vw', maxHeight: '88dvh', borderRadius: 12 }} />
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

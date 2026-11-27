'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { IMG, cardSet, img } from '@/lib/img';

/**
 * The photo gallery, in the two forms it takes on the Kurkoos Group site's execution page:
 * on a phone a fan of three cards that a tap opens into a grid; on a wide screen strips that widen under the pointer.
 * A tap on an opened picture hands its index to `onOpen` (the full-screen viewer).
 */
export type Shot = { id: string; url: string; caption: string | null };
type Props = { images: Shot[]; onOpen: (index: number) => void };

// the fan of the first three cards
const FAN = [
  { rotate: -14, x: -74, y: 14, zIndex: 10 },
  { rotate: -2, x: 0, y: -12, zIndex: 20 },
  { rotate: 12, x: 74, y: 7, zIndex: 30 },
];
const spring = { type: 'spring' as const, stiffness: 320, damping: 30, mass: 0.8 };

function useNarrow(query = '(max-width: 768px)') {
  const [narrow, setNarrow] = useState(true); // phones first: most guests are on one
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    on(); mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return narrow;
}

export function StackGallery({ images, onOpen }: Props) {
  const [open, setOpen] = useState(false);
  const group = useId();
  // the fan is sized from the room it has: on a narrow phone the cards shrink and close up, so no corner is cut off
  const area = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(332);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setRoom(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const card = Math.round(Math.min(216, room * 0.5)), k = Math.min(1, (room * 0.19) / 74);
  // the photos behind the fan are fetched while the guest is still looking at it, so the grid opens with everything in place
  useEffect(() => {
    const rest = images.slice(3);
    if (!rest.length) return;
    const go = () => rest.forEach((m) => { const im = new Image(); im.decoding = 'async'; const set = cardSet(m.url); if (set) { im.sizes = '(max-width: 480px) 50vw, 240px'; im.srcset = set; } im.src = img(m.url, IMG.thumb); });
    const el = area.current;
    if (!el || typeof IntersectionObserver === 'undefined') { go(); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); go(); } }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [images]);
  if (!images.length) return null;
  return (
    <div className="sgal" data-testid="stack-gallery">
      <LayoutGroup id={group}>
        <motion.div ref={area} layout className={`sgal__area ${open ? 'is-expanded' : 'is-stacked'}`} style={{ ['--fan' as string]: `${card}px` }} transition={spring}>
          {images.map((m, i) => {
            if (i >= 3 && !open) return null;
            const fan = images.length === 1 ? { rotate: 0, x: 0, y: 0, zIndex: 10 } : FAN[i] ?? { rotate: 0, x: 0, y: 0, zIndex: i };
            return (
              <motion.button type="button" key={m.id} layoutId={`sgal-${group}-${m.id}`} layout
                className={`sgal__card ${open ? 'is-grid' : 'is-fan'}`}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1, rotate: open ? 0 : fan.rotate, x: open ? 0 : fan.x * k, y: open ? 0 : fan.y * k, zIndex: open ? 10 : fan.zIndex }}
                transition={spring}
                onClick={() => (open ? onOpen(i) : setOpen(true))}
                aria-label={open ? m.caption || `הגדלת תמונה ${i + 1}` : 'הצגת כל התמונות'}>
                <motion.span layout="position" className="sgal__imgwrap">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="sgal__img" src={img(m.url, IMG.thumb)} srcSet={cardSet(m.url)} sizes="(max-width: 480px) 50vw, 240px" alt={m.caption ?? `תמונה ${i + 1}`} loading={i < 3 ? 'eager' : 'lazy'} decoding="async" draggable={false} />
                </motion.span>
              </motion.button>
            );
          })}
        </motion.div>
        <div className="sgal__bar">
          <AnimatePresence mode="wait" initial={false}>
            {open ? (
              <motion.button key="back" type="button" className="sgal__btn" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} onClick={() => setOpen(false)}>
                <span>חזרה</span>
              </motion.button>
            ) : null}
          </AnimatePresence>
        </div>
      </LayoutGroup>
    </div>
  );
}

export function ExpandableGallery({ images, onOpen }: Props) {
  const [hovered, setHovered] = useState<number | null>(null);
  if (!images.length) return null;
  const flex = (i: number) => (hovered === null ? 1 : hovered === i ? 2.1 : 0.7);
  return (
    <div className="xgal" data-testid="expandable-gallery">
      <div className="xgal__row">
        {images.map((m, i) => (
          <motion.button type="button" key={m.id} className="xgal__item" style={{ flex: 1 }} animate={{ flex: flex(i) }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(i)} onBlur={() => setHovered(null)}
            onClick={() => onOpen(i)} aria-label={m.caption || `הגדלת תמונה ${i + 1}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="xgal__img" src={img(m.url, IMG.card)} alt={m.caption ?? `תמונה ${i + 1}`} loading="lazy" decoding="async" />
            <span className="xgal__shade" style={{ opacity: hovered === i ? 0 : 0.16 }} aria-hidden="true" />
          </motion.button>
        ))}
      </div>
    </div>
  );
}

/** Phone: the fan. Wide screen: the strips. The same rule as the page it was taken from. */
export function PlaceGallery(props: Props) {
  const narrow = useNarrow();
  return narrow ? <StackGallery {...props} /> : <ExpandableGallery {...props} />;
}

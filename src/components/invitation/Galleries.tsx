'use client';
import { useEffect, useId, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';

/**
 * The photo gallery, in the two forms it takes on the Kurkoos Group site's execution page:
 * on a phone a fan of three cards that opens into a grid; on a wide screen strips that widen under the pointer.
 * A tap on an opened picture hands its index to `onOpen` (the full-screen viewer).
 */
export type Shot = { id: string; url: string; caption: string | null };
type Props = { images: Shot[]; onOpen: (index: number) => void; allLabel?: string };

// the fan of the first three cards
const FAN = [
  { rotate: -14, x: -74, y: 14, zIndex: 10 },
  { rotate: -2, x: 0, y: -12, zIndex: 20 },
  { rotate: 12, x: 74, y: 7, zIndex: 30 },
];
const spring = { type: 'spring' as const, stiffness: 160, damping: 18, mass: 1 };

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

export function StackGallery({ images, onOpen, allLabel = 'כל התמונות' }: Props) {
  const [open, setOpen] = useState(false);
  const group = useId();
  if (!images.length) return null;
  return (
    <div className="sgal" data-testid="stack-gallery">
      <LayoutGroup id={group}>
        <motion.div layout className={`sgal__area ${open ? 'is-expanded' : 'is-stacked'}`} transition={spring}>
          {images.map((m, i) => {
            if (i >= 3 && !open) return null;
            const fan = images.length === 1 ? { rotate: 0, x: 0, y: 0, zIndex: 10 } : FAN[i] ?? { rotate: 0, x: 0, y: 0, zIndex: i };
            return (
              <motion.button type="button" key={m.id} layoutId={`sgal-${group}-${m.id}`} layout
                className={`sgal__card ${open ? 'is-grid' : 'is-fan'}`}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1, rotate: open ? 0 : fan.rotate, x: open ? 0 : fan.x, y: open ? 0 : fan.y, zIndex: open ? 10 : fan.zIndex }}
                transition={spring}
                onClick={() => (open ? onOpen(i) : setOpen(true))}
                aria-label={open ? m.caption || `הגדלת תמונה ${i + 1}` : 'הצגת כל התמונות'}>
                <motion.span layout="position" className="sgal__imgwrap">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="sgal__img" src={m.url} alt={m.caption ?? ''} loading="lazy" decoding="async" draggable={false} />
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
            ) : images.length > 1 ? (
              <motion.button key="all" type="button" className="sgal__btn" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} onClick={() => setOpen(true)}>
                <span>{allLabel}</span><span className="sgal__count" dir="ltr">{images.length}</span>
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
            <img className="xgal__img" src={m.url} alt={m.caption ?? ''} loading="lazy" decoding="async" />
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

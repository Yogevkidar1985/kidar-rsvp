'use client';
import { useEffect, useRef, useState } from 'react';
import type { Media } from '@/lib/types';
import { img } from '@/lib/img';

/**
 * The photos of one gallery, in the order guests see them. The picture itself stays clear; its controls sit in a bar under it.
 * Three ways to move a photo, all saved at once:
 *  - drag: with a mouse from anywhere on it; with a finger from the grip, or by holding the picture for a moment (a quick
 *    swipe over the picture still scrolls the page);
 *  - swap: tap one photo, then another, and the two change places;
 *  - the arrows move it one place, for a keyboard or a screen reader.
 */
type Props = { items: Media[]; disabled?: boolean; onReorder: (ids: string[]) => void | Promise<void>; onRemove: (m: Media) => void; name: string };

export default function MediaGrid({ items, disabled, onReorder, onRemove, name }: Props) {
  const [order, setOrder] = useState(items);
  const [drag, setDrag] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const live = useRef(order);
  const start = useRef('');
  const dragging = useRef(false);
  useEffect(() => { if (!drag) { setOrder(items); live.current = items; } }, [items, drag]);
  useEffect(() => { if (sel && !items.some((m) => m.id === sel)) setSel(null); }, [items, sel]);
  // while a photo is carried by a finger the page must not scroll under it
  useEffect(() => {
    const stop = (e: TouchEvent) => { if (dragging.current) e.preventDefault(); };
    document.addEventListener('touchmove', stop, { passive: false });
    return () => document.removeEventListener('touchmove', stop);
  }, []);

  const put = (next: Media[]) => { live.current = next; setOrder(next); };
  const commit = () => { const ids = live.current.map((m) => m.id); if (ids.join() !== start.current) void onReorder(ids); };

  /** Carries the photo with the pointer until it is let go. Returns through `done` whether it moved at all. */
  function carry(id: string, done?: (moved: boolean) => void) {
    start.current = live.current.map((m) => m.id).join();
    dragging.current = true; setDrag(id); setSel(null);
    let moved = false;
    const move = (ev: PointerEvent) => {
      const over = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-media-id]');
      const overId = over?.dataset.mediaId;
      if (!over || !overId || overId === id || over.dataset.grid !== name) return;
      const list = live.current, from = list.findIndex((m) => m.id === id), to = list.findIndex((m) => m.id === overId);
      if (from < 0 || to < 0) return;
      moved = true;
      const next = [...list]; next.splice(to, 0, next.splice(from, 1)[0]); put(next);
    };
    const end = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end);
      dragging.current = false; setDrag(null); commit(); done?.(moved);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
  }
  /** A press on the picture: a mouse carries it at once; a finger carries it after a short hold, and a tap selects it for a swap. */
  function press(e: React.PointerEvent, id: string) {
    if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (e.pointerType === 'mouse') { e.preventDefault(); carry(id, (moved) => { if (!moved) tap(id); }); return; }
    const x = e.clientX, y = e.clientY;
    let held = false;
    const hold = window.setTimeout(() => { held = true; try { navigator.vibrate?.(12); } catch { /* not every phone */ } carry(id); cleanup(); }, 320);
    const drift = (ev: PointerEvent) => { if (Math.hypot(ev.clientX - x, ev.clientY - y) > 9) { window.clearTimeout(hold); cleanup(); } }; // it is a scroll
    const up = () => { window.clearTimeout(hold); cleanup(); if (!held) tap(id); };
    const cancel = () => { window.clearTimeout(hold); cleanup(); };
    const cleanup = () => { window.removeEventListener('pointermove', drift); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); };
    window.addEventListener('pointermove', drift); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel);
  }
  /** First tap marks a photo, a tap on another one swaps the two, a tap on the same one lets go. */
  function tap(id: string) {
    if (disabled) return;
    if (!sel) { setSel(id); return; }
    if (sel === id) { setSel(null); return; }
    const list = live.current, a = list.findIndex((m) => m.id === sel), b = list.findIndex((m) => m.id === id);
    setSel(null);
    if (a < 0 || b < 0) return;
    start.current = list.map((m) => m.id).join();
    const next = [...list]; [next[a], next[b]] = [next[b], next[a]]; put(next); commit();
  }
  function grip(e: React.PointerEvent, id: string) {
    if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault(); e.stopPropagation(); carry(id);
  }
  function step(id: string, by: number) {
    const list = live.current, from = list.findIndex((m) => m.id === id), to = from + by;
    if (from < 0 || to < 0 || to >= list.length) return;
    start.current = list.map((m) => m.id).join();
    const next = [...list]; next.splice(to, 0, next.splice(from, 1)[0]); put(next); commit();
  }

  if (!order.length) return null;
  const selAt = sel ? order.findIndex((m) => m.id === sel) + 1 : 0;
  return (
    <>
      <ul className={`media-grid ${sel ? 'is-picking' : ''}`} data-testid={`media-${name}`} aria-label="סדר התמונות">
        {order.map((m, i) => (
          <li key={m.id} data-media-id={m.id} data-grid={name} className={`media-tile ${drag === m.id ? 'is-drag' : ''} ${sel === m.id ? 'is-sel' : ''}`}>
            <div className="media-pic" onPointerDown={(e) => press(e, m.id)} onContextMenu={(e) => e.preventDefault()}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img(m.url, 384)} alt={m.caption ?? `תמונה ${i + 1}`} loading="lazy" decoding="async" draggable={false} />
              <span className={`media-num ${i < 3 ? 'is-top' : ''}`} aria-hidden>{i + 1}</span>
              {sel && sel !== m.id && <span className="media-swap" aria-hidden>החלפה</span>}
            </div>
            <button type="button" className="media-x" aria-label={`הסרת תמונה ${i + 1}`} disabled={disabled} onClick={() => onRemove(m)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
            <div className="media-bar">
              <button type="button" aria-label={`הזזת תמונה ${i + 1} מקום אחד קדימה`} disabled={disabled || i === 0} onClick={() => step(m.id, -1)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 6 6 6-6 6" /></svg>
              </button>
              <button type="button" className="media-grip" aria-label={`גרירת תמונה ${i + 1} למקום אחר`} disabled={disabled} onPointerDown={(e) => grip(e, m.id)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="8" cy="5" r="2" /><circle cx="16" cy="5" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="16" cy="12" r="2" /><circle cx="8" cy="19" r="2" /><circle cx="16" cy="19" r="2" /></svg>
              </button>
              <button type="button" aria-label={`הזזת תמונה ${i + 1} מקום אחד אחורה`} disabled={disabled || i === order.length - 1} onClick={() => step(m.id, 1)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m15 6-6 6 6 6" /></svg>
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p className="media-hint" role="status" aria-live="polite">
        {sel ? <><b>תמונה {selAt} נבחרה.</b> נגעו בתמונה אחרת כדי להחליף ביניהן, או בה שוב לביטול.</>
          : order.length > 1 ? <>גוררים מהידית או בלחיצה ארוכה על התמונה. נגיעה בתמונה ואז באחרת מחליפה ביניהן. שלוש הראשונות (מסומנות בזהב) מוצגות במניפה.</> : null}
      </p>
    </>
  );
}

'use client';
import { useEffect, useRef, useState } from 'react';
import type { Media } from '@/lib/types';

/**
 * The photos of one gallery, in the order guests see them. A photo is moved by dragging it over another:
 * with a mouse from anywhere on it, with a finger from the grip in its corner (so a finger on the picture still scrolls the page).
 * The arrow buttons do the same one step at a time, for a keyboard or a screen reader.
 */
type Props = { items: Media[]; disabled?: boolean; onReorder: (ids: string[]) => void | Promise<void>; onRemove: (m: Media) => void; name: string };

export default function MediaGrid({ items, disabled, onReorder, onRemove, name }: Props) {
  const [order, setOrder] = useState(items);
  const [drag, setDrag] = useState<string | null>(null);
  const live = useRef(order);
  const start = useRef('');
  useEffect(() => { if (!drag) { setOrder(items); live.current = items; } }, [items, drag]);

  const put = (next: Media[]) => { live.current = next; setOrder(next); };
  const commit = () => { const ids = live.current.map((m) => m.id); if (ids.join() !== start.current) void onReorder(ids); };

  function begin(e: React.PointerEvent, id: string) {
    if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    start.current = live.current.map((m) => m.id).join();
    setDrag(id);
    const move = (ev: PointerEvent) => {
      const over = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-media-id]');
      const overId = over?.dataset.mediaId;
      if (!over || !overId || overId === id || over.dataset.grid !== name) return;
      const list = live.current, from = list.findIndex((m) => m.id === id), to = list.findIndex((m) => m.id === overId);
      if (from < 0 || to < 0) return;
      const next = [...list]; next.splice(to, 0, next.splice(from, 1)[0]); put(next);
    };
    const end = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end);
      setDrag(null); commit();
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
  }
  function step(id: string, by: number) {
    const list = live.current, from = list.findIndex((m) => m.id === id), to = from + by;
    if (from < 0 || to < 0 || to >= list.length) return;
    start.current = list.map((m) => m.id).join();
    const next = [...list]; next.splice(to, 0, next.splice(from, 1)[0]); put(next); commit();
  }

  if (!order.length) return null;
  return (
    <>
      <ul className="media-grid" data-testid={`media-${name}`} aria-label="סדר התמונות">
        {order.map((m, i) => (
          <li key={m.id} data-media-id={m.id} data-grid={name} className={`media-tile ${drag === m.id ? 'is-drag' : ''}`}
            onPointerDown={(e) => { if (e.pointerType === 'mouse' && !(e.target as HTMLElement).closest('button')) begin(e, m.id); }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={m.url} alt={m.caption ?? `תמונה ${i + 1}`} draggable={false} />
            <span className="media-num" aria-hidden>{i + 1}</span>
            <button type="button" className="media-grip" aria-label={`גרירת תמונה ${i + 1} למקום אחר`} disabled={disabled} onPointerDown={(e) => begin(e, m.id)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="8" cy="5" r="2" /><circle cx="16" cy="5" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="16" cy="12" r="2" /><circle cx="8" cy="19" r="2" /><circle cx="16" cy="19" r="2" /></svg>
            </button>
            <button type="button" className="media-x" aria-label={`הסרת תמונה ${i + 1}`} disabled={disabled} onClick={() => onRemove(m)}>×</button>
            <span className="media-steps">
              <button type="button" aria-label={`הזזת תמונה ${i + 1} מקום אחד קדימה`} disabled={disabled || i === 0} onClick={() => step(m.id, -1)}>›</button>
              <button type="button" aria-label={`הזזת תמונה ${i + 1} מקום אחד אחורה`} disabled={disabled || i === order.length - 1} onClick={() => step(m.id, 1)}>‹</button>
            </span>
          </li>
        ))}
      </ul>
      {order.length > 1 && <p className="mt-2 text-xs text-muted">גוררים תמונה כדי לשנות את הסדר. שלוש הראשונות הן אלה שמוצגות במניפה.</p>}
    </>
  );
}

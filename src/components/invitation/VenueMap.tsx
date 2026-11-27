'use client';
import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';

/**
 * The venue on a map, with the layer of the Kurkoos Group site's office map: a pale, quiet base with white roads
 * and every street named, a round pin on a short stem, and a fixed white plate above it with the name and the address.
 * Drawn with Leaflet on OpenStreetMap tiles, toned down in CSS, so it needs no key. With `onPick`, a tap moves the pin (the editor).
 */
type Props = { lat: number; lng: number; label: string; sublabel?: string; zoom?: number; onPick?: (lat: number, lng: number) => void;
  /** false: a still picture of the map inside a scrolling page, so a finger moving down the page never drags the map instead */
  interactive?: boolean };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

export default function VenueMap({ lat, lng, label, sublabel = '', zoom = 16, onPick, interactive = true }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const pick = useRef(onPick);
  pick.current = onPick;

  useEffect(() => {
    let dead = false;
    let cleanup = () => {};
    (async () => {
      const L = (await import('leaflet')).default;
      if (dead || !box.current) return;
      const map = L.map(box.current, { center: [lat, lng], zoom, zoomControl: interactive, attributionControl: true, scrollWheelZoom: false,
        dragging: interactive, touchZoom: interactive, doubleClickZoom: interactive, boxZoom: interactive, keyboard: interactive });
      // OpenStreetMap's own tiles need no key. The stylesheet drains their colour to the pale layer the design calls for.
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
      }).addTo(map);
      const icon = L.divIcon({
        className: 'pm-pin', iconSize: [0, 0], iconAnchor: [0, 0],
        html: `<div class="pm-pin__label" dir="rtl"><span class="pm-pin__name">${esc(label)}</span>${sublabel ? `<span class="pm-pin__sub">${esc(sublabel)}</span>` : ''}</div><div class="pm-pin__head"></div><div class="pm-pin__stem"></div><div class="pm-pin__shadow"></div>`,
      });
      const marker = L.marker([lat, lng], { icon, keyboard: false, interactive: false }).addTo(map);
      map.on('click', (e) => { if (pick.current) { marker.setLatLng(e.latlng); pick.current(e.latlng.lat, e.latlng.lng); } });
      // an in-app browser resizes its window in the first seconds, and a sheet slides in: measure again once things settle
      const timers = [0, 350, 1200].map((ms) => window.setTimeout(() => { if (!dead) map.invalidateSize(); }, ms));
      const ro = new ResizeObserver(() => map.invalidateSize());
      ro.observe(box.current);
      cleanup = () => { timers.forEach(clearTimeout); ro.disconnect(); map.remove(); };
    })();
    return () => { dead = true; cleanup(); };
  }, [lat, lng, label, sublabel, zoom, interactive]);

  // the map lays its tiles out left to right; the plate above the pin declares its own direction
  return <div ref={box} className="venue-map" role="img" aria-label={`מפה: ${label}${sublabel ? `, ${sublabel}` : ''}`} dir="ltr" data-testid="venue-map" />;
}

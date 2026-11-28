'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useEvent } from '@/components/admin/EventContext';
import { PageHead } from '@/components/admin/Shell';
import { Field, Modal, dbError, useToast } from '@/components/admin/ui';
import { VersionsList } from '@/components/admin/Versions';
import { EVENT_KEEP, versions } from '@/lib/versions';
import { DateField, TimeField } from '@/components/admin/fields';
import { Icon } from '@/components/admin/icons';
import dynamic from 'next/dynamic';

const VenueMap = dynamic(() => import('@/components/invitation/VenueMap'), { ssr: false });
import InvitationView from '@/components/invitation/InvitationView';
import { HEBREW_FONTS, PALETTES, applyFont, applyPalette, resolveDesign } from '@/lib/defaults';
import { hebrewDate, weekdayLabel } from '@/lib/hebrew-date';
import MediaGrid from '@/components/admin/MediaGrid';
import { refreshPublic } from '@/lib/refresh-public';
import { MIX, shape } from '@/components/invitation/Particles';
import type { Design, EventRow, Media, ParticleKind, TextStyle } from '@/lib/types';

const TABS = ['תוכן', 'מועד', 'מקום', 'תמונות', 'גדלים', 'טיפוגרפיה', 'צבעים', 'אנימציות', 'אישורי הגעה'] as const;
type Tab = (typeof TABS)[number];
const DEVICES = [{ key: 'mobile', label: 'נייד', w: 390 }, { key: 'tablet', label: 'טאבלט', w: 768 }, { key: 'desktop', label: 'מחשב', w: 1180 }] as const;
const KINDS: { key: ParticleKind; label: string }[] = [
  { key: 'confetti', label: 'קונפטי' }, { key: 'mix', label: 'מיקס חגיגי' }, { key: 'ribbons', label: 'סרטים' }, { key: 'dots', label: 'עיגולים' }, { key: 'squares', label: 'ריבועים' }, { key: 'triangles', label: 'משולשים' },
  { key: 'sparkles', label: 'נצנוצים' }, { key: 'stars', label: 'כוכבים' }, { key: 'hearts', label: 'לבבות' }, { key: 'petals', label: 'עלי כותרת' }, { key: 'feathers', label: 'נוצות' },
];
const COLOR_SETS: { name: string; colors: string[] }[] = [
  { name: 'ניגודי', colors: ['#3D3531', '#F0655F', '#E9B44C', '#2E9E8F', '#FFFFFF', '#8A6BBE'] },
  { name: 'צבעוני', colors: ['#F25F5C', '#FFB703', '#3A86FF', '#2EC4B6', '#8E7DBE'] },
  { name: 'פסטל', colors: ['#F7C6CE', '#BFD8F2', '#FCE7A8', '#C9E4C5', '#DCCBEA'] },
  { name: 'זהב', colors: ['#C9A24A', '#E6CF8F', '#F6EBCB', '#9C7A2B'] },
  { name: 'תכלת', colors: ['#7FB4DE', '#B9D8F0', '#3F7FB5', '#EAF4FB'] },
];
const SIZE_KEYS: { key: keyof Design['sizes']; label: string; min: number; max: number }[] = [
  { key: 'date', label: 'התאריך (1× = מלוא רוחב ההזמנה)', min: 0.5, max: 1 }, { key: 'countdown', label: 'הספירה לאחור', min: 0.6, max: 1.4 }, { key: 'emblem', label: 'האייקון שמעל השמות', min: 0.5, max: 2.5 },
  { key: 'logo', label: 'לוגו המקום', min: 0.5, max: 2.5 }, { key: 'arrow', label: 'החץ שעל התמונה', min: 0.5, max: 2 }, { key: 'buttons', label: 'הכפתורים', min: 0.8, max: 1.4 }, { key: 'gallery', label: 'כרטיסי הגלריה', min: 0.6, max: 1.1 },
];
const STYLE_KEYS: { key: keyof Design['styles']; label: string }[] = [
  { key: 'headline', label: 'כותרת ראשית' }, { key: 'hosts', label: 'שמות ומקום' }, { key: 'date', label: 'תאריך ושעות' }, { key: 'body', label: 'טקסט רץ' },
];
const COLOR_KEYS: { key: keyof Design['colors']; label: string }[] = [
  { key: 'bg', label: 'רקע העמוד' }, { key: 'surface', label: 'רקע ההזמנה' }, { key: 'soft', label: 'רקע משני' }, { key: 'ink', label: 'צבע ראשי' }, { key: 'muted', label: 'טקסט משני' },
  { key: 'accent', label: 'צבע הדגשה' }, { key: 'line', label: 'קווים ומסגרות' }, { key: 'button', label: 'כפתור אישור' }, { key: 'buttonText', label: 'טקסט הכפתור' },
];

async function shrink(file: File, max = 2000): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/jpeg', 0.86));
  } catch { return file; }
}

/** One kind, drawn with the real drawing code in the chosen colours, so the tile shows what will fall. */
function KindTile({ kind, colors, thick, label, active, onPick }: { kind: ParticleKind; colors: string[]; thick: number; label: string; active: boolean; onPick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current, ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2), W = 72, H = 40;
    c.width = W * dpr; c.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const spots = [[14, 14, -0.5, 6], [36, 24, 0.35, 7.5], [58, 13, 0.9, 6], [24, 31, 1.4, 4.5], [50, 31, -1.1, 5]];
    spots.forEach(([x, y, rot, r], i) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
      ctx.fillStyle = colors[i % colors.length] ?? '#888';
      shape(ctx, kind === 'mix' ? MIX[i % MIX.length] : kind, r * (kind === 'ribbons' ? 0.7 : 1), thick);
      ctx.restore();
    });
  }, [kind, colors, thick]);
  return (
    <button type="button" className="kind-tile" aria-pressed={active} onClick={onPick}>
      <canvas ref={ref} style={{ width: 72, height: 40 }} aria-hidden />
      <span>{label}</span>
    </button>
  );
}
function KindPicker({ value, colors, thick, onChange, name }: { value: ParticleKind; colors: string[]; thick: number; onChange: (k: ParticleKind) => void; name: string }) {
  return <div className="kind-grid" role="group" aria-label={name} data-testid={`kinds-${name}`}>{KINDS.map((k) => <KindTile key={k.key} kind={k.key} label={k.label} colors={colors} thick={thick} active={value === k.key} onPick={() => onChange(k.key)} />)}</div>;
}

/** Which part of the invitation a control changes: where it is in the preview, and what to measure there. */
const PARTS: Record<string, { sel: string; unit: 'font' | 'height' | 'width'; of?: string }> = {
  text: { sel: '.inv-first p', unit: 'font' }, headline: { sel: '.inv-first h1, .inv-first h2', unit: 'font' }, hosts: { sel: '.inv-names', unit: 'font' },
  body: { sel: '.inv-first p', unit: 'font' }, dateText: { sel: '.inv-dateline', unit: 'font' },
  date: { sel: '.inv-datenum', unit: 'font' }, countdown: { sel: '[data-testid=countdown]', unit: 'font', of: '[data-testid=countdown] b' },
  emblem: { sel: '[data-testid=emblem]', unit: 'width' }, logo: { sel: '.inv-venue-logo', unit: 'height' }, arrow: { sel: '.inv-scroll', unit: 'width' },
  buttons: { sel: '.inv-options', unit: 'height', of: '.inv-options .inv-btn' }, gallery: { sel: '[data-testid=stack-gallery]', unit: 'width', of: '[data-testid=stack-gallery] .sgal__card' },
  confetti: { sel: '.inv-hero', unit: 'width' }, spacing: { sel: '.inv-when', unit: 'height' },
};
const PART_OF_STYLE: Record<string, string> = { headline: 'headline', hosts: 'hosts', date: 'dateText', body: 'body' };
const PartCtx = createContext<{ show: (part: string) => void; sizes: Record<string, string> }>({ show: () => {}, sizes: {} });

/** A slider with a minus and a plus beside it: on a phone a finger lands on a button more surely than on a thin track.
 *  With `part`, touching it brings that part of the invitation into the preview, and the real size is written beside the value. */
function Range({ label, value, min, max, step, onChange, suffix = '', part }: { label: string; value: number; min: number; max: number; step: number; onChange: (n: number) => void; suffix?: string; part?: string }) {
  const ctx = useContext(PartCtx);
  const digits = (String(step).split('.')[1] ?? '').length;
  const touch = () => { if (part) ctx.show(part); };
  const move = (by: number) => { touch(); onChange(Math.min(max, Math.max(min, +(value + by * step).toFixed(digits)))); };
  const real = part && suffix !== 'px' ? ctx.sizes[part] : '';
  return (
    <div className="rng" data-part={part}>
      <div className="rng-top"><span className="label !mb-0">{label}</span><output dir="ltr">{+value.toFixed(digits)}{suffix}{real && <small> · {real}</small>}</output></div>
      <div className="rng-row">
        <button type="button" aria-label={`${label}: פחות`} disabled={value <= min} onClick={() => move(-1)}>−</button>
        <label><span className="sr-only">{label}</span><input type="range" min={min} max={max} step={step} value={value} onPointerDown={touch} onFocus={touch} onChange={(e) => { touch(); onChange(Number(e.target.value)); }} /></label>
        <button type="button" aria-label={`${label}: יותר`} disabled={value >= max} onClick={() => move(1)}>+</button>
      </div>
    </div>
  );
}

export default function EditorPage() {
  const { event, setEvent, canEdit } = useEvent();
  const toast = useToast();
  const db = supabaseBrowser();
  const [draft, setDraftRaw] = useState<EventRow>(event);
  // undo / redo: a snapshot is kept when an edit starts more than half a second after the previous one
  const hist = useRef<{ past: EventRow[]; future: EventRow[]; at: number }>({ past: [], future: [], at: 0 });
  const [, bump] = useState(0);
  const setDraft: typeof setDraftRaw = useCallback((next) => {
    setDraftRaw((cur) => {
      const val = typeof next === 'function' ? (next as (d: EventRow) => EventRow)(cur) : next;
      const h = hist.current, now = Date.now();
      if (val !== cur && now - h.at > 500) { h.past = [...h.past.slice(-49), cur]; h.future = []; }
      h.at = now;
      return val;
    });
    bump((n) => n + 1);
  }, []);
  const step = (dir: 'undo' | 'redo') => {
    const h = hist.current;
    const from = dir === 'undo' ? h.past : h.future;
    if (!from.length) return;
    setDraftRaw((cur) => {
      const target = from[from.length - 1];
      if (dir === 'undo') { h.past = h.past.slice(0, -1); h.future = [...h.future, cur]; } else { h.future = h.future.slice(0, -1); h.past = [...h.past, cur]; }
      h.at = 0;
      return target;
    });
    bump((n) => n + 1);
  };
  const [media, setMedia] = useState<Media[]>([]);
  const [tab, setTabRaw] = useState<Tab>('תוכן');
  const formTop = useRef<HTMLElement>(null);
  useEffect(() => { const want = new URLSearchParams(window.location.search).get('tab') as Tab | null; if (want && TABS.includes(want)) setTabRaw(want); }, []);
  const setTab = (next: Tab, scroll = false) => {
    setTabRaw(next);
    const u = new URL(window.location.href); u.searchParams.set('tab', next); window.history.replaceState(null, '', u);
    if (scroll) formTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const [device, setDevice] = useState<(typeof DEVICES)[number]>(DEVICES[0]);
  const [view, setView] = useState<'edit' | 'preview'>('edit');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [celebrate, setCelebrate] = useState(0);
  const [styleKey, setStyleKey] = useState<keyof Design['styles']>('headline');
  const pane = useRef<HTMLDivElement>(null);
  const [locating, setLocating] = useState(false);
  /** Finds the written address on the map, once, from the editor. Guests never trigger a lookup: they get the saved point. */
  async function locate() {
    const place = [draft.venue_name, draft.address].filter(Boolean).join(', ');
    const tries = [draft.address, place].filter((x): x is string => !!x && x.trim().length > 3);
    if (!tries.length) return toast('כתבו קודם את הכתובת המלאה, כולל עיר.', true);
    setLocating(true);
    try {
      for (const q of tries) {
        const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=he&countrycodes=il&q=${encodeURIComponent(q)}`);
        const hit = ((await r.json()) as { lat: string; lon: string }[])[0];
        if (hit) { setDesign({ geo: { lat: +hit.lat, lng: +hit.lon, place } }); toast('הכתובת נמצאה. אם הסיכה לא מדויקת, לחצו על המפה כדי להזיז אותה.'); return; }
      }
      toast('לא מצאנו את הכתובת. נסו לכתוב רחוב, מספר ועיר.', true);
    } catch { toast('החיפוש נכשל. בדקו את החיבור ונסו שוב.', true); } finally { setLocating(false); }
  }
  const [paneW, setPaneW] = useState(390);
  const frame = useRef<HTMLDivElement>(null);
  const [dock, setDock] = useState(true);            // phone: a strip of the real invitation stays above the controls
  const [sizes, setSizes] = useState<Record<string, string>>({});
  const flash = useRef(0);
  /** Brings a part of the invitation into the preview and outlines it for a moment. */
  const showPart = useCallback((part: string) => {
    const box = frame.current, p = part.startsWith('line:') ? { sel: `[data-line="${part.slice(5)}"]` } : PARTS[part];
    if (!box || !p) return;
    const el = box.querySelector<HTMLElement>(p.sel);
    if (!el) return;
    box.querySelectorAll('[data-ed-mark]').forEach((x) => x.removeAttribute('data-ed-mark'));
    el.setAttribute('data-ed-mark', '');
    const k = box.getBoundingClientRect().width / box.offsetWidth || 1;          // the frame is drawn scaled
    const top = (el.getBoundingClientRect().top - box.getBoundingClientRect().top) / k + box.scrollTop;
    box.scrollTo({ top: Math.max(0, top - (box.clientHeight - el.offsetHeight) / 2), behavior: 'smooth' });
    window.clearTimeout(flash.current);
    flash.current = window.setTimeout(() => el.removeAttribute('data-ed-mark'), 1800);
  }, []);
  /** A tap on a part of the preview leads to the control that sizes it. */
  const fromPreview = (e: React.MouseEvent) => {
    const hit = e.target as HTMLElement;
    const line = hit.closest<HTMLElement>('[data-line]')?.dataset.line;
    if (line) { // a tap on a line of text leads to that line's own size
      setTab('גדלים'); setView('edit'); showPart(`line:${line}`);
      window.setTimeout(() => { const row = document.querySelector<HTMLElement>(`.rng[data-part="line:${line}"]`); row?.scrollIntoView({ block: 'center', behavior: 'smooth' }); row?.setAttribute('data-hit', ''); window.setTimeout(() => row?.removeAttribute('data-hit'), 1600); }, 120);
      return;
    }
    const part = ['date', 'countdown', 'emblem', 'logo', 'arrow', 'buttons', 'gallery'].find((k) => hit.closest(PARTS[k].sel)) ?? (hit.closest('.inv-names') ? 'hosts' : hit.closest('.inv-first h1, .inv-first h2') ? 'headline' : hit.closest('.inv-dateline') ? 'dateText' : hit.closest('.inv-first p') ? 'body' : null);
    if (!part) return;
    const style = Object.entries(PART_OF_STYLE).find(([, v]) => v === part)?.[0] as keyof Design['styles'] | undefined;
    if (style) { setStyleKey(style); setTab('טיפוגרפיה'); } else setTab('גדלים');
    setView('edit'); showPart(part);
    window.setTimeout(() => { const row = document.querySelector<HTMLElement>(`.rng[data-part="${part}"]`); row?.scrollIntoView({ block: 'center', behavior: 'smooth' }); row?.setAttribute('data-hit', ''); window.setTimeout(() => row?.removeAttribute('data-hit'), 1600); }, 120);
  };
  const design = useMemo(() => resolveDesign(draft.design), [draft.design]);
  /** Every line of text on the invitation, in the order it is read. */
  const textLines = useMemo(() => {
    const out: { key: string; label: string }[] = [];
    const cut = (t: string) => (t.length > 26 ? `${t.slice(0, 26)}…` : t);
    const one = (key: string, what: string, t?: string | null) => { if (t?.trim()) out.push({ key, label: `${what}: ${cut(t.trim())}` }); };
    const many = (key: string, what: string, t?: string | null) => { if (t) t.split('\n').forEach((row, i) => { if (row.trim()) out.push({ key: `${key}.${i}`, label: `${what}: ${cut(row.trim())}` }); }); };
    one('latin', 'שורה באנגלית', design.latin); one('names', 'שמות בראש', draft.hosts); one('kicker', 'שם האירוע', draft.name);
    many('headline', 'כותרת', draft.headline); many('intro', 'פתיחה', draft.intro_text); many('closing', 'סיום', draft.closing_text); one('sign', 'חתימה', draft.hosts);
    one('dateline', 'יום ותאריך עברי', [draft.weekday_label, draft.hebrew_date].filter(Boolean).join(' – ')); one('venue', 'שם המקום', draft.venue_name); one('address', 'כתובת', draft.address);
    one('rsvpTitle', 'כותרת אישור ההגעה', design.labels.rsvpTitle); out.push({ key: 'rsvpHint', label: 'אישור הגעה: אנא סמנו את סטטוס ההגעה' });
    return out;
  }, [draft, design]);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(event), [draft, event]);

  const loadMedia = useCallback(async () => {
    const { data } = await db.from('media_assets').select('id,kind,url,caption,path,sort').eq('event_id', event.id).order('sort').order('created_at');
    setMedia((data as Media[]) ?? []);
  }, [db, event.id]);
  useEffect(() => { void loadMedia(); }, [loadMedia]);
  useEffect(() => {
    if (!pane.current) return;
    const ro = new ResizeObserver(([e]) => setPaneW(e.contentRect.width));
    ro.observe(pane.current);
    return () => ro.disconnect();
  }, [view]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // ---- work that was never saved survives a closed tab: it waits on this device until it is saved or thrown away ----
  const draftKey = `ed-draft:${event.id}`;
  const [recover, setRecover] = useState<EventRow | null>(null);
  const waiting = useRef(false);
  useEffect(() => {
    try {
      const kept = JSON.parse(window.localStorage.getItem(draftKey) ?? 'null') as { base: string; draft: EventRow } | null;
      if (kept?.draft && kept.base === event.updated_at && JSON.stringify(kept.draft) !== JSON.stringify(event)) { waiting.current = true; setRecover(kept.draft); }
      else window.localStorage.removeItem(draftKey);
    } catch { /* private mode: nothing is kept, the editor works as before */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (waiting.current) return;
    const id = window.setTimeout(() => {
      try { if (dirty) window.localStorage.setItem(draftKey, JSON.stringify({ base: event.updated_at, draft })); else window.localStorage.removeItem(draftKey); } catch { /* storage full or blocked */ }
    }, 700);
    return () => window.clearTimeout(id);
  }, [draft, dirty, draftKey, event.updated_at]);
  const [showVersions, setShowVersions] = useState(false);
  const [verStamp, setVerStamp] = useState(0);

  const saveRef = useRef<() => void>(() => {});
  const stepRef = useRef<(d: 'undo' | 'redo') => void>(() => {});
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); saveRef.current(); return; }
      // inside a text box the browser's own undo stays in charge of the typing
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'TEXTAREA' || el.isContentEditable || (el.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'color', 'button'].includes((el as HTMLInputElement).type)));
      if (typing) return;
      if (k === 'z') { e.preventDefault(); stepRef.current(e.shiftKey ? 'redo' : 'undo'); }
      else if (k === 'y') { e.preventDefault(); stepRef.current('redo'); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const set = <K extends keyof EventRow>(k: K, v: EventRow[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setDesign = (patch: Partial<Design>) => setDraft((d) => ({ ...d, design: { ...resolveDesign(d.design), ...patch } }));
  const setStyle = (patch: Partial<TextStyle>) => setDesign({ styles: { ...design.styles, [styleKey]: { ...design.styles[styleKey], ...patch } } });
  const text = (k: keyof EventRow, label: string, opts: { area?: boolean; ltr?: boolean; hint?: string; placeholder?: string } = {}) => (
    <Field label={label} hint={opts.hint}>
      {opts.area
        ? <textarea className="field" rows={3} maxLength={1000} value={(draft[k] as string) ?? ''} onChange={(e) => set(k, e.target.value as never)} />
        : <input className="field" dir={opts.ltr ? 'ltr' : undefined} maxLength={300} placeholder={opts.placeholder} value={(draft[k] as string) ?? ''} onChange={(e) => set(k, e.target.value as never)} />}
    </Field>
  );

  const [autoAt, setAutoAt] = useState('');
  const autoKept = useRef(0);
  async function save(publish?: boolean, quiet = false) {
    const sent = draft;
    setSaving(true);
    const { id, created_at, updated_at, ...rest } = draft;
    void created_at; void updated_at;
    const row = { ...rest, design, published: publish ?? draft.published };
    for (const k of ['waze_url', 'gmaps_url', 'video_url'] as const) {
      const v = (row[k] ?? '').trim();
      if (v && !/^https:\/\//i.test(v)) { setSaving(false); return quiet ? undefined : toast('קישורים צריכים להתחיל ב-https://', true); }
      row[k] = v || null;
    }
    // the version that is about to be replaced is kept first; an identical copy is not written twice
    if (canEdit && !quiet) await versions.snapshot(id, 'event', 'לפני שינוי');
    const { data, error } = await db.from('events').update(row).eq('id', id).select('*').single();
    setSaving(false);
    if (error || !data) return quiet ? undefined : toast(error?.code === '23505' ? 'כתובת ההזמנה כבר תפוסה.' : dbError(error), true);
    if (quiet) {
      // typing went on while the save travelled: what was typed since stays, only the saved base moves
      setEvent(data as EventRow); setDraftRaw((cur) => (cur === sent ? (data as EventRow) : { ...cur, updated_at: (data as EventRow).updated_at }));
      setAutoAt(new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }));
      // one kept copy every few minutes of autosaving is enough: the list stays readable
      if (Date.now() - autoKept.current > 180000) { autoKept.current = Date.now(); void versions.snapshot(id, 'event', 'שמירה אוטומטית').then(() => setVerStamp((n) => n + 1)); }
      return;
    }
    setEvent(data as EventRow); setDraftRaw(data as EventRow); void refreshPublic(event.id, event.slug);
    try { window.localStorage.removeItem(draftKey); } catch { /* nothing kept */ }
    void versions.snapshot(id, 'event', publish === true ? 'פורסמה' : publish === false ? 'הפרסום בוטל' : 'נשמרה').then(() => setVerStamp((n) => n + 1));
    toast(publish === true ? 'ההזמנה פורסמה' : publish === false ? 'הפרסום בוטל' : 'השינויים נשמרו');
  }

  async function upload(files: FileList | null, kind: 'hero' | 'gallery' | 'venue') {
    if (!files?.length) return;
    setUploading(true);
    let next = Math.max(-1, ...media.map((m) => m.sort ?? 0)) + 1; // new photos go to the end, in the order they were picked
    try {
      for (const f of Array.from(files).slice(0, kind === 'hero' ? 1 : 12)) {
        if (f.size > 25 * 1024 * 1024) { toast('הקובץ גדול מדי (עד 25MB).', true); continue; }
        const blob = await shrink(f);
        const path = `${event.id}/${kind}-${crypto.randomUUID()}.jpg`;
        const up = await db.storage.from('event-media').upload(path, blob, { contentType: blob.type || 'image/jpeg', cacheControl: '31536000' });
        if (up.error) { toast('ההעלאה נכשלה. נסו קובץ JPG או PNG.', true); continue; }
        const url = db.storage.from('event-media').getPublicUrl(path).data.publicUrl;
        if (kind === 'hero') {
          const pos = { ...draft.hero_pos, x: 50, y: 50, zoom: 1, ratio: draft.hero_pos?.ratio ?? '4/5' };
          const { data, error } = await db.from('events').update({ hero_url: url, hero_pos: pos }).eq('id', event.id).select('*').single();
          if (error || !data) { toast(dbError(error), true); continue; }
          setEvent(data as EventRow); setDraftRaw((d) => ({ ...d, hero_url: url, hero_pos: pos, updated_at: (data as EventRow).updated_at }));
        } else {
          const { error } = await db.from('media_assets').insert({ event_id: event.id, kind, url, path, sort: next++ });
          if (error) toast(dbError(error), true);
        }
      }
      await loadMedia(); void refreshPublic(event.id); toast('התמונות הועלו');
    } finally { setUploading(false); }
  }
  /** The venue's logo is kept as it was drawn: a PNG keeps its transparent background. */
  async function uploadLogo(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return toast('לוגו מעלים כקובץ PNG, JPG או WebP.', true);
    if (f.size > 3 * 1024 * 1024) return toast('הקובץ גדול מדי (עד 3MB).', true);
    setUploading(true);
    try {
      const path = `${event.id}/logo-${crypto.randomUUID()}.${f.type.split('/')[1].replace('jpeg', 'jpg')}`;
      const up = await db.storage.from('event-media').upload(path, f, { contentType: f.type, cacheControl: '31536000' });
      if (up.error) return toast('ההעלאה נכשלה. נסו שוב.', true);
      setDesign({ venueLogo: db.storage.from('event-media').getPublicUrl(path).data.publicUrl });
      toast('הלוגו נוסף. שמרו כדי שיופיע בהזמנה.');
    } finally { setUploading(false); }
  }
  async function removeMedia(m: Media) {
    const { error } = await db.from('media_assets').delete().eq('id', m.id);
    if (error) return toast(dbError(error), true);
    if (m.path) await db.storage.from('event-media').remove([m.path]);
    await loadMedia(); void refreshPublic(event.id);
  }

  const pos = Object.assign({ x: 50, y: 50, zoom: 1, ratio: '4/5', brightness: 1, contrast: 1, overlay: 0 }, draft.hero_pos);
  // "before" shows the invitation as guests see it now, so a change can be judged against it
  const [before, setBefore] = useState(false);
  useEffect(() => { if (!dirty) setBefore(false); }, [dirty]);
  const previewData = useMemo(() => (before ? { ...event, design: resolveDesign(event.design), media } : { ...draft, design, media }), [before, event, draft, design, media]);
  const scale = Math.min(1, paneW / device.w);
  const st = design.styles[styleKey];
  const drop = (kind: 'hero' | 'gallery' | 'venue', label: string) => (
    <label role="button" className={`btn btn-ghost w-full ${uploading ? 'pointer-events-none opacity-60' : ''}`}>
      {uploading ? 'מעלים…' : label}
      <input type="file" accept="image/*" multiple={kind !== 'hero'} className="sr-only" disabled={uploading || !canEdit} onChange={(e) => { void upload(e.target.files, kind); e.target.value = ''; }} />
    </label>
  );
  async function reorder(kind: 'gallery' | 'venue', ids: string[]) {
    const before = media;
    const byId = new Map(media.map((m) => [m.id, m]));
    setMedia([...media.filter((m) => m.kind !== kind), ...ids.map((id, i) => ({ ...byId.get(id)!, sort: i }))]);
    const res = await Promise.all(ids.map((id, i) => (byId.get(id)?.sort === i ? null : db.from('media_assets').update({ sort: i }).eq('id', id))));
    const failed = res.find((r) => r?.error);
    if (failed?.error) { setMedia(before); toast(dbError(failed.error), true); await loadMedia(); }
    void refreshPublic(event.id);
  }
  const thumbs = (kind: 'gallery' | 'venue') => (
    <MediaGrid name={kind} items={media.filter((m) => m.kind === kind)} disabled={!canEdit} onReorder={(ids) => reorder(kind, ids)} onRemove={removeMedia} />
  );

  saveRef.current = () => { if (canEdit && dirty && !saving) void save(); };
  // ---- autosave: a draft nobody can see yet saves itself after a quiet moment. A published invitation never does:
  // guests would see half a sentence. There the work waits on this device until "save" is pressed. ----
  const autoRef = useRef<() => void>(() => {});
  autoRef.current = () => { if (canEdit && dirty && !saving && !uploading && !draft.published && !recover && draft.name?.trim()) void save(undefined, true); };
  useEffect(() => {
    if (!dirty || draft.published) return;
    const id = window.setTimeout(() => autoRef.current(), 2500);
    return () => window.clearTimeout(id);
  }, [draft, dirty]);
  stepRef.current = step;
  /** Puts an older version into the editor. Nothing is saved until the person saves; one undo brings back what was there. */
  const loadVersion = (data: Record<string, unknown>, label: string) => {
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) if (!EVENT_KEEP.includes(k) && k in draft) patch[k] = v;
    setDraft((d) => ({ ...d, ...patch } as EventRow)); setShowVersions(false); setView('preview');
    toast(`הגרסה "${label}" מוצגת בתצוגה. שמרו כדי להחיל אותה, או לחצו ביטול כדי לחזור.`);
  };
  // what an invitation needs before it goes out, each step pointing at the tab that fills it
  const venuePhotos = media.filter((m) => m.kind === 'venue').length;
  const steps: { label: string; ok: boolean; tab: Tab; optional?: boolean }[] = [
    { label: 'שמות וכותרת', ok: !!(draft.name?.trim() && draft.headline?.trim() && draft.hosts?.trim()), tab: 'תוכן' },
    { label: 'תאריך ושעה', ok: !!(draft.event_date && (draft.reception_time || draft.ceremony_time)), tab: 'מועד' },
    { label: 'מקום וכתובת', ok: !!(draft.venue_name?.trim() && draft.address?.trim()), tab: 'מקום' },
    { label: 'סיכה על המפה', ok: !!design.geo, tab: 'מקום', optional: true },
    { label: 'תמונה ראשית', ok: !!draft.hero_url, tab: 'תמונות', optional: true },
    { label: 'תמונות מהמקום', ok: venuePhotos > 0, tab: 'תמונות', optional: true },
  ];
  const must = steps.filter((s) => !s.optional), mustDone = must.filter((s) => s.ok).length;
  const tabAt = TABS.indexOf(tab);
  // how large each part really is right now, read from the preview itself
  useEffect(() => {
    const id = window.setTimeout(() => {
      const box = frame.current;
      if (!box) return;
      const next: Record<string, string> = {};
      for (const [key, p] of Object.entries(PARTS)) {
        const el = box.querySelector<HTMLElement>(p.of ?? p.sel);
        if (!el || key === 'confetti' || key === 'spacing') continue;
        const cs = getComputedStyle(el);
        const px = p.unit === 'font' ? parseFloat(cs.fontSize) : p.unit === 'height' ? el.offsetHeight : el.offsetWidth;
        if (px) next[key] = `${Math.round(px)}px`;
      }
      box.querySelectorAll<HTMLElement>('[data-line]').forEach((el) => { next[`line:${el.dataset.line}`] = `${Math.round(parseFloat(getComputedStyle(el).fontSize))}px`; });
      setSizes((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
    }, 180);
    return () => window.clearTimeout(id);
  }, [previewData, tab, view, paneW]);
  const tileColors = design.fall.colors.map((c) => (/^#f{3}(f{3})?$/i.test(c) ? design.colors.line : c));
  return (
    <PartCtx.Provider value={{ show: showPart, sizes }}>
      <PageHead title="עיצוב ההזמנה" sub={saving ? 'שומרים…' : dirty ? (draft.published ? 'יש שינויים שלא נשמרו · האורחים יראו אותם רק אחרי שמירה' : 'נשמר לבד בעוד רגע…') : draft.published ? 'פורסמה · כל השינויים שמורים' : `טיוטה · נשמרת לבד${autoAt ? ` · נשמרה ב-${autoAt}` : ''}`}>
        <button className="btn btn-ghost btn-icon" aria-label="ביטול הפעולה האחרונה" title="ביטול" disabled={!hist.current.past.length} onClick={() => step('undo')}><Icon name="undo" /></button>
        <button className="btn btn-ghost btn-icon" aria-label="ביצוע מחדש" title="ביצוע מחדש" disabled={!hist.current.future.length} onClick={() => step('redo')}><Icon name="redo" /></button>
        <button className="btn btn-ghost hidden lg:inline-flex" data-testid="open-versions" title="כל הגרסאות השמורות של ההזמנה" onClick={() => setShowVersions(true)}>גרסאות</button>
        {dirty && <button className="btn btn-ghost hidden lg:inline-flex" title="מחזיר את ההזמנה לגרסה השמורה האחרונה" onClick={() => setDraft(event)}>ביטול השינויים</button>}
        <button className="btn btn-ghost lg:hidden" onClick={() => setView(view === 'edit' ? 'preview' : 'edit')}><Icon name="eye" />{view === 'edit' ? 'תצוגה' : 'עריכה'}</button>
        <button className={draft.published ? 'btn btn-ghost' : 'btn'} disabled={!canEdit || saving} onClick={() => save(!draft.published)}>{draft.published ? 'ביטול פרסום' : 'שמירה ופרסום'}</button>
        <button className={`${draft.published ? 'btn' : 'btn btn-ghost'} hidden lg:inline-flex`} disabled={!canEdit || saving || !dirty} onClick={() => save()}>{saving ? 'שומרים…' : draft.published ? 'שמירת השינויים' : 'שמירת טיוטה'}</button>
      </PageHead>

      {recover && (
        <div className="notice mb-3 flex flex-wrap items-center gap-2" role="status" data-testid="ed-recover">
          <span className="grow">נמצאו שינויים מהפעם הקודמת שלא נשמרו.</span>
          <button type="button" className="btn btn-sm" onClick={() => { waiting.current = false; setDraft(recover); setRecover(null); toast('השינויים חזרו לעורך. שמרו כדי להחיל אותם.'); }}>החזרת השינויים</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { waiting.current = false; setRecover(null); try { window.localStorage.removeItem(draftKey); } catch { /* nothing kept */ } }}>מחיקה</button>
        </div>
      )}
      {showVersions && (
        <Modal title="גרסאות ההזמנה" wide onClose={() => setShowVersions(false)}>
          <p className="mb-3 text-sm text-muted">גרסה נשמרת לבד בכל שמירה. "הצגה בתצוגה" מראה גרסה ישנה בלי לשמור: אם היא מתאימה שומרים, ואם לא לוחצים ביטול.</p>
          <VersionsList eventId={event.id} kind="event" canEdit={canEdit} stamp={verStamp} onLoad={(data, v) => loadVersion(data, v.label || 'גרסה')} />
        </Modal>
      )}
      <section className={`card ed-steps ${view === 'preview' ? 'hidden lg:block' : ''}`} data-testid="ed-steps" aria-label="מה נשאר להזמנה">
        <div className="ed-steps__head">
          <b>{mustDone === must.length ? (draft.published ? 'ההזמנה מוכנה ומפורסמת' : 'הכול מלא. נשאר רק לפרסם') : `נשארו ${must.length - mustDone} שלבים להשלמה`}</b>
          <span className="ed-steps__bar" aria-hidden="true"><i style={{ width: `${(steps.filter((s) => s.ok).length / steps.length) * 100}%` }} /></span>
          <button type="button" className="btn btn-ghost btn-sm lg:hidden" onClick={() => setShowVersions(true)}>גרסאות</button>
        </div>
        <ul>
          {steps.map((s) => (
            <li key={s.label}><button type="button" className={s.ok ? 'is-ok' : s.optional ? 'is-opt' : 'is-todo'} onClick={() => { setView('edit'); setTab(s.tab, true); }}>
              <span aria-hidden="true">{s.ok ? '✓' : s.optional ? '+' : '!'}</span>{s.label}<span className="sr-only">{s.ok ? ' (מלא)' : s.optional ? ' (רשות, עוד לא מולא)' : ' (חסר)'}</span></button></li>
          ))}
        </ul>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(320px,420px)_1fr] lg:items-start">
        <section ref={formTop} className={`card ed-form p-4 ${view === 'preview' ? 'hidden lg:block' : ''}`}>
          <div className="tabs ed-tabs mb-4" role="tablist">
            {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t}</button>)}
          </div>
          <fieldset disabled={!canEdit} className="grid gap-3">
            {tab === 'תוכן' && <>
              {text('name', 'שם האירוע', { hint: 'מופיע בכותרת הדפדפן, בשיתוף וביומן.' })}
              <Field label="שורה באנגלית בראש ההזמנה" hint="למשל שמות המארחים. אפשר להשאיר ריק.">
                <input className="field" dir="ltr" maxLength={60} value={design.latin} onChange={(e) => setDesign({ latin: e.target.value })} /></Field>
              {text('headline', 'כותרת ראשית')}
              {text('intro_text', 'טקסט פתיחה', { area: true })}
              {text('hosts', 'בעלי האירוע')}
              {text('closing_text', 'טקסט סיום', { area: true })}
              <p className="text-sm text-muted">את כתובת ההזמנה, תצוגת הקישור ב-WhatsApp והקישורים האישיים עורכים במסך <a className="font-medium underline" href={`/admin/events/${event.id}/links`}>קישורים</a>.</p>
            </>}
            {tab === 'מועד' && <>
              <div><span className="label">תאריך האירוע</span>
                <DateField label="תאריך האירוע" value={draft.event_date} onChange={(v) => setDraft((d) => ({ ...d, event_date: v, weekday_label: v ? weekdayLabel(v) : d.weekday_label, hebrew_date: v ? hebrewDate(v) : d.hebrew_date }))} />
                <span className="mt-1 block text-xs text-muted">היום בשבוע והתאריך העברי מחושבים לבד.</span></div>
              {text('weekday_label', 'יום בשבוע')}
              <Field label="תאריך עברי" hint="מחושב מהתאריך הלועזי, ואפשר לערוך ידנית.">
                <div className="flex gap-2"><input className="field" value={draft.hebrew_date ?? ''} onChange={(e) => set('hebrew_date', e.target.value)} />
                  <button type="button" className="btn btn-ghost" disabled={!draft.event_date} onClick={() => draft.event_date && set('hebrew_date', hebrewDate(draft.event_date))}>חישוב</button></div></Field>
              <div className="grid gap-3 sm:grid-cols-3">
                {([['reception_time', 'קבלת פנים'], ['ceremony_time', 'טקס'], ['end_time', 'סיום']] as const).map(([k, l]) => (
                  <div key={k}><span className="label">{l}</span><TimeField label={l} value={draft[k]} onChange={(v) => set(k, v)} /></div>
                ))}
              </div>
            </>}
            {tab === 'מקום' && <>
              {text('venue_name', 'שם המקום')}
              {text('address', 'כתובת מלאה')}
              <Field label="האתר של המקום" hint="מוסיף חיצים ליד שם המקום. לחיצה פותחת את האתר בתוך ההזמנה.">
                <input className="field" dir="ltr" inputMode="url" maxLength={200} placeholder="https://" value={design.venueUrl} onChange={(e) => setDesign({ venueUrl: e.target.value.trim() })} /></Field>
              {design.venueUrl && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" data-testid="venue-preload" checked={design.venuePreload} onChange={(e) => setDesign({ venuePreload: e.target.checked })} /><span><b className="font-semibold">טעינה מוקדמת של אתר המקום</b><span className="block text-xs text-muted">האתר מתחיל להיטען ברקע כשהאורח מגיע לשם המקום, ונפתח מיד בלחיצה. משתמש בגלישה של האורח גם אם לא ילחץ.</span></span></label>}
              <div>
                <span className="label">לוגו המקום (מוצג בכרטיס "איך מגיעים", מעל השם)</span>
                <div className="flex flex-wrap items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {design.venueLogo && <img src={design.venueLogo} alt="לוגו המקום" className="h-12 max-w-40 rounded border border-line bg-white object-contain p-1" />}
                  <label role="button" className={`btn btn-ghost btn-sm ${uploading ? 'pointer-events-none opacity-60' : ''}`}>{design.venueLogo ? 'החלפת הלוגו' : 'העלאת לוגו'}
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={uploading || !canEdit} onChange={(e) => { void uploadLogo(e.target.files); e.target.value = ''; }} /></label>
                  {design.venueLogo && <button type="button" className="btn btn-danger btn-sm" onClick={() => setDesign({ venueLogo: null })}>הסרה</button>}
                </div>
              </div>
              {text('waze_url', 'קישור Waze', { ltr: true, placeholder: 'https://waze.com/ul/...', hint: 'אם יישאר ריק, הניווט ייפתח לפי הכתובת.' })}
              {text('gmaps_url', 'קישור Google Maps', { ltr: true, placeholder: 'https://maps.app.goo.gl/...' })}
              {text('contact_phone', 'טלפון ליצירת קשר', { ltr: true })}
              {text('directions', 'הוראות הגעה', { area: true })}
              {text('parking', 'חניה', { area: true })}
              {text('extra_info', 'מידע נוסף על האירוע', { area: true })}
              <div className="border-t border-line pt-3"><span className="label">תמונות של המקום (מוצגות בהזמנה תחת "מידע נוסף")</span>{drop('venue', 'הוספת תמונות של המקום')}{thumbs('venue')}</div>
              <div className="grid gap-2 border-t border-line pt-3">
                <span className="label">מיקום על מפת ההגעה</span>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="btn btn-ghost" disabled={locating} onClick={locate}>{locating ? 'מחפשים…' : design.geo ? 'איתור מחדש לפי הכתובת' : 'איתור הכתובת על המפה'}</button>
                  {design.geo && <button type="button" className="btn btn-danger btn-sm" onClick={() => setDesign({ geo: null })}>הסרת הסיכה</button>}
                </div>
                {design.geo ? (
                  <>
                    <div className="inv-map" style={{ ['--inv-line' as string]: 'var(--color-line)', ['--inv-radius-box' as string]: '12px', ['--inv-soft' as string]: '#f2f4f6', ['--inv-ink' as string]: design.colors.ink, ['--inv-dim' as string]: design.colors.muted, ['--inv-font' as string]: 'inherit' }}>
                      <VenueMap lat={design.geo.lat} lng={design.geo.lng} label={draft.venue_name || draft.name} sublabel={draft.address ?? ''} onPick={(lat, lng) => setDesign({ geo: { lat, lng, place: design.geo?.place ?? '' } })} />
                    </div>
                    <p className="text-xs text-muted">לחיצה על המפה מזיזה את הסיכה. {design.geo.place !== [draft.venue_name, draft.address].filter(Boolean).join(', ') && <b className="text-warn">הכתובת השתנתה מאז האיתור: כדאי לאתר מחדש.</b>}</p>
                  </>
                ) : <p className="text-xs text-muted">אחרי האיתור, ההזמנה מציגה מפה מעוצבת עם סיכה ושלט. בלי איתור מוצגת מפת Google רגילה לפי הכתובת.</p>}
              </div>
              <div className="grid gap-2 border-t border-line pt-3">
                <span className="label">כפתורים בהזמנה</span>
                {(['navigate', 'calendar', 'call'] as const).map((k) => (
                  <div key={k} className="flex items-center gap-2">
                    <input type="checkbox" aria-label={`הצגת כפתור ${design.labels[k]}`} checked={design.buttons[k]} onChange={(e) => setDesign({ buttons: { ...design.buttons, [k]: e.target.checked } })} />
                    <input className="field" aria-label={`הטקסט על כפתור ${design.labels[k]}`} maxLength={30} value={design.labels[k]} onChange={(e) => setDesign({ labels: { ...design.labels, [k]: e.target.value } })} />
                  </div>
                ))}
              </div>
            </>}
            {tab === 'תמונות' && <>
              <span className="label">תמונה ראשית</span>
              {drop('hero', draft.hero_url ? 'החלפת התמונה הראשית' : 'העלאת תמונה ראשית')}
              {!draft.hero_url && <p className="text-xs text-muted">עד שתעלו תמונה משלכם, ההזמנה מציגה את תמונת ברירת המחדל.</p>}
              {draft.hero_url && <>
                <Range label="זום" value={pos.zoom} min={1} max={2.5} step={0.05} onChange={(n) => set('hero_pos', { ...pos, zoom: n })} suffix="×" />
                <Range label="מיקום אופקי" value={pos.x} min={0} max={100} step={1} onChange={(n) => set('hero_pos', { ...pos, x: n })} suffix="%" />
                <Range label="מיקום אנכי" value={pos.y} min={0} max={100} step={1} onChange={(n) => set('hero_pos', { ...pos, y: n })} suffix="%" />
                <Range label="בהירות" value={pos.brightness} min={0.6} max={1.4} step={0.02} onChange={(n) => set('hero_pos', { ...pos, brightness: n })} />
                <Range label="ניגודיות" value={pos.contrast} min={0.7} max={1.3} step={0.02} onChange={(n) => set('hero_pos', { ...pos, contrast: n })} />
                <Range label="שכבת כהות מעל התמונה" value={pos.overlay} min={0} max={0.5} step={0.02} onChange={(n) => set('hero_pos', { ...pos, overlay: n })} />
                <button type="button" className="btn btn-danger btn-sm justify-self-start" onClick={() => set('hero_url', null)}>הסרת התמונה</button>
              </>}
              <div className="grid grid-cols-2 gap-2">
                <Field label="יחס התמונה"><select className="field" value={pos.ratio} onChange={(e) => set('hero_pos', { ...pos, ratio: e.target.value })}>
                  <option value="4/5">4:5 לאורך</option><option value="3/4">3:4 לאורך</option><option value="1/1">ריבוע</option><option value="9/16">9:16 גבוה</option><option value="16/10">16:10 לרוחב</option></select></Field>
                <Field label="צורת המסגרת"><select className="field" value={design.heroShape} onChange={(e) => setDesign({ heroShape: e.target.value as Design['heroShape'] })}>
                  <option value="arch">קשת</option><option value="rounded">פינות מעוגלות</option><option value="full">מלוא הרוחב</option></select></Field>
              </div>
              <div className="border-t border-line pt-3"><span className="label">גלריית האירוע</span>{drop('gallery', 'הוספת תמונות לגלריה')}{thumbs('gallery')}</div>
              <div className="border-t border-line pt-3"><span className="label">תמונות האולם והמקום</span>{drop('venue', 'הוספת תמונות של המקום')}{thumbs('venue')}</div>
              {text('video_url', 'סרטון (קישור YouTube או קובץ MP4)', { ltr: true, placeholder: 'https://' })}
            </>}
            {tab === 'גדלים' && <>
              <p className="text-sm text-muted">נגיעה במחוון מביאה את החלק הזה לתצוגה המקדימה ומסמנת אותו. ליד כל ערך כתוב הגודל בפועל. אפשר גם ללחוץ על חלק בתצוגה כדי להגיע למחוון שלו.</p>
              <Range part="text" label="כל הטקסט בהזמנה" value={design.textScale} min={0.85} max={1.4} step={0.05} onChange={(n) => setDesign({ textScale: n })} suffix="×" />
              {SIZE_KEYS.map((s) => <Range key={s.key} part={s.key} label={s.label} value={design.sizes[s.key]} min={s.min} max={s.max} step={0.05} onChange={(n) => setDesign({ sizes: { ...design.sizes, [s.key]: n } })} suffix="×" />)}
              <div className="grid gap-3 border-t border-line pt-3" data-testid="line-sizes">
                <div><b className="text-[15px]">גודל לכל שורה</b><p className="text-sm text-muted">כל שורת טקסט בהזמנה מקבלת גודל משלה. 1× הוא הגודל הרגיל שלה. אפשר גם ללחוץ על שורה בתצוגה.</p></div>
                {textLines.map((l) => <Range key={l.key} part={`line:${l.key}`} label={l.label} value={design.lines[l.key] ?? 1} min={0.5} max={2.5} step={0.05} onChange={(n) => { const next = { ...design.lines }; if (n === 1) delete next[l.key]; else next[l.key] = n; setDesign({ lines: next }); }} suffix="×" />)}
                {Object.keys(design.lines).length > 0 && <button type="button" className="btn btn-ghost btn-sm justify-self-start" data-testid="lines-reset" onClick={() => setDesign({ lines: {} })}>איפוס גודל השורות</button>}
              </div>
              <Range part="spacing" label="מרווח בין חלקי ההזמנה" value={design.spacing} min={0.4} max={1.8} step={0.05} onChange={(n) => setDesign({ spacing: n })} suffix="×" />
              <Range part="confetti" label="כמות הקונפטי" value={design.fall.count} min={4} max={120} step={2} onChange={(n) => setDesign({ fall: { ...design.fall, count: n } })} />
              <Range part="confetti" label="גודל הקונפטי" value={design.fall.size} min={0.5} max={2.5} step={0.1} onChange={(n) => setDesign({ fall: { ...design.fall, size: n } })} suffix="×" />
              <Range part="confetti" label="עובי הקונפטי" value={design.fall.thick} min={0.4} max={2.5} step={0.1} onChange={(n) => setDesign({ fall: { ...design.fall, thick: n } })} suffix="×" />
              <button type="button" className="btn btn-ghost btn-sm justify-self-start" onClick={() => setDesign({ textScale: 1.15, spacing: 1, sizes: { date: 1, countdown: 1, emblem: 1, logo: 1, arrow: 1, buttons: 1, gallery: 1 } })}>חזרה לגדלים המקוריים</button>
            </>}
            {tab === 'טיפוגרפיה' && <>
              <Field label="פונט אחיד לכל ההזמנה" hint="מחליף את הפונט בכל הטקסטים, הכפתורים והטופס בבת אחת.">
                <select className="field" data-testid="font" value={design.font} onChange={(e) => setDesign(applyFont(design, e.target.value))}>
                  {HEBREW_FONTS.map((f, i) => <option key={f} value={f}>{f}{i ? '' : ' (מומלץ)'}</option>)}</select></Field>
              <Field label="פינות הכפתורים והשדות"><select className="field" value={design.corners} onChange={(e) => setDesign({ corners: e.target.value as Design['corners'] })}>
                <option value="soft">מעוגלות בעדינות</option><option value="sharp">חדות</option><option value="pill">עגולות לגמרי</option></select></Field>
              <p className="border-t border-line pt-3 text-xs text-muted">כוונון עדין לכל סוג טקסט בנפרד:</p>
              <div className="tabs">{STYLE_KEYS.map((s) => <button key={s.key} type="button" aria-pressed={styleKey === s.key} onClick={() => { setStyleKey(s.key); showPart(PART_OF_STYLE[s.key]); }}>{s.label}</button>)}</div>
              <Range part={PART_OF_STYLE[styleKey]} label="גודל" value={st.size} min={12} max={96} step={1} onChange={(n) => setStyle({ size: n })} suffix="px" />
              <Range part={PART_OF_STYLE[styleKey]} label="עובי" value={st.weight} min={100} max={900} step={100} onChange={(n) => setStyle({ weight: n })} />
              <Range part={PART_OF_STYLE[styleKey]} label="מרווח אותיות" value={st.spacing} min={-0.05} max={0.4} step={0.01} onChange={(n) => setStyle({ spacing: n })} suffix="em" />
              <Range part={PART_OF_STYLE[styleKey]} label="גובה שורה" value={st.lineHeight} min={0.9} max={2.2} step={0.05} onChange={(n) => setStyle({ lineHeight: n })} />
              <div className="grid grid-cols-2 gap-2">
                <Field label="יישור"><select className="field" value={st.align} onChange={(e) => setStyle({ align: e.target.value as TextStyle['align'] })}><option value="center">מרכז</option><option value="right">ימין</option><option value="left">שמאל</option></select></Field>
                <Field label="צבע"><input className="field !p-1" type="color" value={st.color} onChange={(e) => setStyle({ color: e.target.value })} /></Field>
              </div>
            </>}
            {tab === 'צבעים' && <>
              <Range label="ניגודיות הטקסט" value={design.contrast} min={0} max={1} step={0.05} onChange={(n) => setDesign({ contrast: n })} />
              <Range label="עוצמת צבעי הקונפטי" value={design.fall.intensity} min={0.2} max={1} step={0.05} onChange={(n) => setDesign({ fall: { ...design.fall, intensity: n } })} />
              <p className="text-xs text-muted">ניגודיות גבוהה מכהה את הטקסט האפור (תאריך עברי, כתובת, תוויות) עד לצבע הטקסט הראשי.</p>
              <span className="label">פלטות מוכנות</span>
              <div className="grid gap-2" data-testid="palettes">
                {PALETTES.map((p) => (
                  <button key={p.id} type="button" aria-pressed={design.palette === p.id} onClick={() => setDesign(applyPalette(design, p))}
                    className={`flex items-center gap-3 rounded-xl border p-2 text-start ${design.palette === p.id ? 'border-ink ring-2 ring-ink/15' : 'border-line hover:bg-paper'}`}>
                    <span className="flex h-10 w-28 flex-none overflow-hidden rounded-lg border border-line" aria-hidden="true">
                      {[p.colors.surface, p.colors.soft, p.colors.line, p.colors.accent, p.colors.ink].map((c, i) => <span key={i} className="flex-1" style={{ background: c }} />)}
                    </span>
                    <span><b className="block text-sm">{p.name}</b><small className="text-muted">{p.mood}</small></span>
                  </button>
                ))}
              </div>
              {design.saved.length > 0 && <>
                <span className="label">הפלטות שלי</span>
                <div className="grid gap-2">
                  {design.saved.map((p, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <button type="button" onClick={() => setDesign(applyPalette(design, { id: 'custom', name: p.name, mood: '', colors: p.colors, fall: [p.colors.accent, p.colors.line, '#FFFFFF', p.colors.muted] }))}
                        className="flex flex-1 items-center gap-3 rounded-xl border border-line p-2 text-start hover:bg-paper">
                        <span className="flex h-8 w-24 flex-none overflow-hidden rounded-lg border border-line" aria-hidden="true">
                          {[p.colors.surface, p.colors.soft, p.colors.line, p.colors.accent, p.colors.ink].map((c, j) => <span key={j} className="flex-1" style={{ background: c }} />)}
                        </span>
                        <b className="text-sm">{p.name}</b>
                      </button>
                      <button type="button" className="btn btn-danger btn-sm" aria-label={`מחיקת הפלטה ${p.name}`} onClick={() => setDesign({ saved: design.saved.filter((_, j) => j !== i) })}>×</button>
                    </div>
                  ))}
                </div>
              </>}
              <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                <button type="button" className="btn btn-ghost btn-sm" disabled={design.saved.length >= 8} onClick={() => setDesign({ saved: [...design.saved, { name: `הפלטה שלי ${design.saved.length + 1}`, colors: design.colors }] })}>שמירת הצבעים הנוכחיים כפלטה</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDesign(applyPalette(design, PALETTES[0]))}>חזרה לברירת המחדל</button>
              </div>
              <p className="text-xs text-muted">התאמה אישית של צבע בודד:</p>
              <div className="grid grid-cols-2 gap-3">
                {COLOR_KEYS.map((c) => <Field key={c.key} label={c.label}><input className="field !p-1" type="color" value={design.colors[c.key]} onChange={(e) => setDesign({ palette: 'custom', colors: { ...design.colors, [c.key]: e.target.value } })} /></Field>)}
              </div>
            </>}
            {tab === 'אנימציות' && <>
              <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={design.entrance} onChange={(e) => setDesign({ entrance: e.target.checked })} />כניסה הדרגתית של התמונה והטקסטים</label>
              <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={design.extras.sparkle} onChange={(e) => setDesign({ extras: { ...design.extras, sparkle: e.target.checked } })} />נצנוצים ליד השמות וקו מפריד שמצייר את עצמו</label>
              <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={design.extras.countdown} onChange={(e) => setDesign({ extras: { ...design.extras, countdown: e.target.checked } })} />ספירה לאחור עד האירוע</label>
              <Field label="האייקון שבין התמונה לשמות"><select className="field" data-testid="emblem-pick" value={design.emblem} onChange={(e) => setDesign({ emblem: e.target.value as Design['emblem'] })}>
                <option value="pacifier">מוצץ</option><option value="stroller">עגלת תינוק</option><option value="heart">לב</option><option value="star">כוכב</option><option value="none">בלי אייקון</option></select></Field>
              <div className="grid gap-3 border-t border-line pt-3" data-testid="fall-controls">
                <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={design.fall.enabled} onChange={(e) => setDesign({ fall: { ...design.fall, enabled: e.target.checked } })} />קונפטי שנופל מהתמונה</label>
                {design.fall.enabled && <>
                  <div><span className="label">סוג</span><KindPicker name="fall" value={design.fall.kind} colors={tileColors} thick={design.fall.thick} onChange={(k) => setDesign({ fall: { ...design.fall, kind: k } })} /></div>
                  <div className="grid gap-3">
                    <Range label="מהירות" value={design.fall.speed} min={0.3} max={2.5} step={0.1} onChange={(n) => setDesign({ fall: { ...design.fall, speed: n } })} suffix="×" />
                    <Range label="כמות" value={design.fall.count} min={4} max={120} step={1} onChange={(n) => setDesign({ fall: { ...design.fall, count: n } })} />
                    <Range label="גודל" value={design.fall.size} min={0.5} max={2.5} step={0.1} onChange={(n) => setDesign({ fall: { ...design.fall, size: n } })} suffix="×" />
                    <Range label="עובי" value={design.fall.thick} min={0.4} max={2.5} step={0.1} onChange={(n) => setDesign({ fall: { ...design.fall, thick: n } })} suffix="×" />
                    <Range label="עוצמת הצבע" value={design.fall.intensity} min={0.2} max={1} step={0.05} onChange={(n) => setDesign({ fall: { ...design.fall, intensity: n } })} />
                    <Range label="משך (0 = ללא הפסקה)" value={design.fall.duration} min={0} max={30} step={1} onChange={(n) => setDesign({ fall: { ...design.fall, duration: n } })} suffix=" שנ׳" />
                  </div>
                  <div>
                    <span className="label">צבעים</span>
                    <div className="flex flex-wrap items-center gap-2" data-testid="fall-colors">
                      {design.fall.colors.map((c, i) => (
                        <span key={i} className="swatch">
                          <input type="color" aria-label={`צבע ${i + 1}`} value={c} onChange={(e) => setDesign({ fall: { ...design.fall, colors: design.fall.colors.map((x, j) => (j === i ? e.target.value : x)) } })} />
                          {design.fall.colors.length > 1 && <button type="button" aria-label={`הסרת צבע ${i + 1}`} onClick={() => setDesign({ fall: { ...design.fall, colors: design.fall.colors.filter((_, j) => j !== i) } })}>×</button>}
                        </span>
                      ))}
                      {design.fall.colors.length < 8 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDesign({ fall: { ...design.fall, colors: [...design.fall.colors, design.colors.accent] } })}>+ צבע</button>}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {COLOR_SETS.map((s) => <button key={s.name} type="button" className="btn btn-ghost btn-sm" onClick={() => setDesign({ fall: { ...design.fall, colors: s.colors } })}><span className="flex" aria-hidden>{s.colors.slice(0, 5).map((c) => <i key={c} style={{ background: c }} className="-ms-1 inline-block h-3.5 w-3.5 rounded-full border border-white first:ms-0" />)}</span>{s.name}</button>)}
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDesign({ fall: { ...design.fall, colors: (PALETTES.find((p) => p.id === design.palette)?.fall) ?? [design.colors.accent, design.colors.line, '#FFFFFF', design.colors.muted] } })}>צבעי ההזמנה</button>
                    </div>
                  </div>
                </>}
              </div>
              <div className="grid gap-3 border-t border-line pt-3">
                <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={design.celebrate.enabled} onChange={(e) => setDesign({ celebrate: { ...design.celebrate, enabled: e.target.checked } })} />חגיגה אחרי אישור הגעה</label>
                {design.celebrate.enabled && <>
                  <p className="text-xs text-muted">האפקט מופעל רק אחרי שהתשובה נשמרה בשרת, בצבעים שנבחרו למעלה.</p>
                  <div><span className="label">סוג</span><KindPicker name="celebrate" value={design.celebrate.kind} colors={tileColors} thick={design.celebrate.thick} onChange={(k) => setDesign({ celebrate: { ...design.celebrate, kind: k } })} /></div>
                  <div className="grid gap-3">
                    <Range label="מהירות" value={design.celebrate.speed} min={0.5} max={2} step={0.1} onChange={(n) => setDesign({ celebrate: { ...design.celebrate, speed: n } })} suffix="×" />
                    <Range label="כמות" value={design.celebrate.count} min={20} max={300} step={10} onChange={(n) => setDesign({ celebrate: { ...design.celebrate, count: n } })} />
                    <Range label="גודל" value={design.celebrate.size} min={0.5} max={2.5} step={0.1} onChange={(n) => setDesign({ celebrate: { ...design.celebrate, size: n } })} suffix="×" />
                    <Range label="עובי" value={design.celebrate.thick} min={0.4} max={2.5} step={0.1} onChange={(n) => setDesign({ celebrate: { ...design.celebrate, thick: n } })} suffix="×" />
                    <Range label="משך" value={design.celebrate.duration} min={1} max={10} step={0.5} onChange={(n) => setDesign({ celebrate: { ...design.celebrate, duration: n } })} suffix=" שנ׳" />
                  </div>
                  <button type="button" className="btn btn-ghost" onClick={() => { setView('preview'); setCelebrate((n) => n + 1); }}>הפעלת החגיגה בתצוגה המקדימה</button>
                </>}
              </div>
            </>}
            {tab === 'אישורי הגעה' && <>
              <Field label="כותרת אזור אישור ההגעה"><input className="field" maxLength={60} value={design.labels.rsvpTitle} onChange={(e) => setDesign({ labels: { ...design.labels, rsvpTitle: e.target.value } })} /></Field>
              <Field label="טקסט הכפתור הצף"><input className="field" maxLength={60} value={design.labels.rsvp} onChange={(e) => setDesign({ labels: { ...design.labels, rsvp: e.target.value } })} /></Field>
              <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={draft.rsvp_settings?.open !== false} onChange={(e) => set('rsvp_settings', { ...draft.rsvp_settings, open: e.target.checked })} />אישורי ההגעה פתוחים</label>
              <Field label="מקסימום משתתפים באישור ללא קישור אישי" hint="למשפחות עם קישור אישי קובע מספר המקומות שהוקצה להן.">
                <input className="field" type="number" min={1} max={50} value={draft.rsvp_settings?.max_party ?? 15} onChange={(e) => set('rsvp_settings', { ...draft.rsvp_settings, max_party: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })} /></Field>
            </>}
          </fieldset>
          <div className="ed-next">
            {tabAt > 0 ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTab(TABS[tabAt - 1], true)}>→ {TABS[tabAt - 1]}</button> : <span />}
            {tabAt < TABS.length - 1
              ? <button type="button" className="btn btn-sm" onClick={() => setTab(TABS[tabAt + 1], true)}>הבא: {TABS[tabAt + 1]} ←</button>
              : <button type="button" className="btn btn-sm" disabled={!canEdit || saving || (!dirty && draft.published)} onClick={() => save(draft.published ? undefined : true)}>{draft.published ? 'שמירת השינויים' : 'שמירה ופרסום'}</button>}
          </div>
        </section>

        <section className={`card ed-preview overflow-hidden ${view === 'edit' ? `ed-dock ${dock ? '' : 'is-off'}` : ''}`} data-testid="ed-dock">
          <div className="ed-preview-head flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-sm font-medium text-muted">תצוגה מקדימה <a className="ed-open ms-2 underline" href={`/${event.slug}?test=1`} target="_blank" rel="noreferrer">פתיחה בחלון</a></span>
            <div className="tabs ed-devices">{DEVICES.map((d) => <button key={d.key} onClick={() => setDevice(d)} aria-pressed={device.key === d.key}>{d.label}</button>)}</div>
            {dirty && <div className="tabs ed-compare" data-testid="ed-compare" role="group" aria-label="השוואה לגרסה השמורה"><button type="button" aria-pressed={before} onClick={() => setBefore(true)}>לפני</button><button type="button" aria-pressed={!before} onClick={() => setBefore(false)}>אחרי</button></div>}
            <button type="button" className="ed-dock-toggle btn btn-ghost btn-sm" aria-expanded={dock} onClick={() => setDock(!dock)}>{dock ? 'הסתרה' : 'הצגה'}</button>
          </div>
          <div ref={pane} className="ed-pane overflow-hidden bg-[#eef1f5]" data-testid="preview-pane">
            <div ref={frame} onClickCapture={fromPreview} data-testid="preview-frame" style={{ width: device.w, height: `calc(var(--pane-h, 78dvh) / ${scale})`, transform: `scale(${scale})`, transformOrigin: 'top right', marginInlineStart: Math.max(0, (paneW - device.w * scale) / 2), overflowY: 'auto', position: 'relative' }}>
              <InvitationView data={previewData} preview celebrateKey={celebrate} />
            </div>
          </div>
        </section>
      </div>
      {/* phone: unsaved work keeps a save bar within reach, above the navigation */}
      {dirty && canEdit && (
        <div className="no-print fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-30 flex items-center gap-2 border-t border-line bg-white/95 px-4 py-2 backdrop-blur lg:hidden">
          <span className="flex-1 text-sm text-muted">יש שינויים שלא נשמרו</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setDraft(event)}>ביטול</button>
          <button className="btn btn-sm" disabled={saving} onClick={() => save()}>{saving ? 'שומרים…' : 'שמירה'}</button>
        </div>
      )}
    </PartCtx.Provider>
  );
}

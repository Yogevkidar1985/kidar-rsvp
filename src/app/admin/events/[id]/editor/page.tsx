'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useEvent } from '@/components/admin/EventContext';
import { PageHead } from '@/components/admin/Shell';
import { Field, dbError, useToast } from '@/components/admin/ui';
import InvitationView from '@/components/invitation/InvitationView';
import { HEBREW_FONTS, PALETTES, applyFont, applyPalette, resolveDesign } from '@/lib/defaults';
import { hebrewDate, weekdayLabel } from '@/lib/hebrew-date';
import type { Design, EventRow, Media, ParticleKind, TextStyle } from '@/lib/types';

const TABS = ['תוכן', 'מועד', 'מקום', 'תמונות', 'טיפוגרפיה', 'צבעים', 'אנימציות', 'אישורי הגעה'] as const;
type Tab = (typeof TABS)[number];
const DEVICES = [{ key: 'mobile', label: 'נייד', w: 390 }, { key: 'tablet', label: 'טאבלט', w: 768 }, { key: 'desktop', label: 'מחשב', w: 1180 }] as const;
const KINDS: { key: ParticleKind; label: string }[] = [
  { key: 'feathers', label: 'נוצות' }, { key: 'petals', label: 'עלי כותרת' }, { key: 'confetti', label: 'קונפטי' }, { key: 'hearts', label: 'לבבות' }, { key: 'stars', label: 'כוכבים' },
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

function Range({ label, value, min, max, step, onChange, suffix = '' }: { label: string; value: number; min: number; max: number; step: number; onChange: (n: number) => void; suffix?: string }) {
  return (
    <label className="block">
      <span className="label flex justify-between"><span>{label}</span><span dir="ltr">{value}{suffix}</span></span>
      <input type="range" className="w-full accent-[#1b2440]" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
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
  const [tab, setTab] = useState<Tab>('תוכן');
  const [device, setDevice] = useState<(typeof DEVICES)[number]>(DEVICES[0]);
  const [view, setView] = useState<'edit' | 'preview'>('edit');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [celebrate, setCelebrate] = useState(0);
  const [styleKey, setStyleKey] = useState<keyof Design['styles']>('headline');
  const pane = useRef<HTMLDivElement>(null);
  const [paneW, setPaneW] = useState(390);
  const design = useMemo(() => resolveDesign(draft.design), [draft.design]);
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

  async function save(publish?: boolean) {
    setSaving(true);
    const { id, created_at, updated_at, ...rest } = draft;
    void created_at; void updated_at;
    const row = { ...rest, design, published: publish ?? draft.published };
    for (const k of ['waze_url', 'gmaps_url', 'video_url'] as const) {
      const v = (row[k] ?? '').trim();
      if (v && !/^https:\/\//i.test(v)) { setSaving(false); return toast('קישורים צריכים להתחיל ב-https://', true); }
      row[k] = v || null;
    }
    const { data, error } = await db.from('events').update(row).eq('id', id).select('*').single();
    setSaving(false);
    if (error || !data) return toast(error?.code === '23505' ? 'כתובת ההזמנה כבר תפוסה.' : dbError(error), true);
    setEvent(data as EventRow); setDraftRaw(data as EventRow);
    toast(publish === true ? 'ההזמנה פורסמה' : publish === false ? 'הפרסום בוטל' : 'השינויים נשמרו');
  }

  async function upload(files: FileList | null, kind: 'hero' | 'gallery' | 'venue') {
    if (!files?.length) return;
    setUploading(true);
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
          const { error } = await db.from('media_assets').insert({ event_id: event.id, kind, url, path, sort: media.length });
          if (error) toast(dbError(error), true);
        }
      }
      await loadMedia(); toast('התמונות הועלו');
    } finally { setUploading(false); }
  }
  async function removeMedia(m: Media) {
    const { error } = await db.from('media_assets').delete().eq('id', m.id);
    if (error) return toast(dbError(error), true);
    if (m.path) await db.storage.from('event-media').remove([m.path]);
    await loadMedia();
  }

  const pos = Object.assign({ x: 50, y: 50, zoom: 1, ratio: '4/5', brightness: 1, contrast: 1, overlay: 0 }, draft.hero_pos);
  const previewData = useMemo(() => ({ ...draft, design, media }), [draft, design, media]);
  const scale = Math.min(1, paneW / device.w);
  const st = design.styles[styleKey];
  const drop = (kind: 'hero' | 'gallery' | 'venue', label: string) => (
    <label role="button" className={`btn btn-ghost w-full ${uploading ? 'pointer-events-none opacity-60' : ''}`}>
      {uploading ? 'מעלים…' : label}
      <input type="file" accept="image/*" multiple={kind !== 'hero'} className="sr-only" disabled={uploading || !canEdit} onChange={(e) => { void upload(e.target.files, kind); e.target.value = ''; }} />
    </label>
  );
  const thumbs = (kind: 'gallery' | 'venue') => (
    <div className="mt-2 grid grid-cols-3 gap-2">
      {media.filter((m) => m.kind === kind).map((m) => (
        <div key={m.id} className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={m.url} alt="" className="aspect-square w-full rounded-lg object-cover" />
          <button type="button" className="absolute left-1 top-1 rounded-md bg-white/90 px-1.5 text-sm font-bold text-no" aria-label="הסרת התמונה" onClick={() => removeMedia(m)}>×</button>
        </div>
      ))}
    </div>
  );

  return (
    <>
      <PageHead title="עיצוב ההזמנה" sub={dirty ? 'יש שינויים שלא נשמרו' : 'כל השינויים שמורים'}>
        <button className="btn btn-ghost" aria-label="ביטול הפעולה האחרונה" title="ביטול" disabled={!hist.current.past.length} onClick={() => step('undo')}>↶</button>
        <button className="btn btn-ghost" aria-label="ביצוע מחדש" title="ביצוע מחדש" disabled={!hist.current.future.length} onClick={() => step('redo')}>↷</button>
        <button className="btn btn-ghost" disabled={!dirty} title="מחזיר את ההזמנה לגרסה השמורה האחרונה" onClick={() => setDraft(event)}>שחזור הגרסה השמורה</button>
        <button className="btn btn-ghost lg:hidden" onClick={() => setView(view === 'edit' ? 'preview' : 'edit')}>{view === 'edit' ? 'תצוגה מקדימה' : 'חזרה לעריכה'}</button>
        <button className="btn btn-ghost" disabled={!canEdit || saving} onClick={() => save(!draft.published)}>{draft.published ? 'ביטול פרסום' : 'שמירה ופרסום'}</button>
        <button className="btn" disabled={!canEdit || saving || !dirty} onClick={() => save()}>{saving ? 'שומרים…' : draft.published ? 'שמירת השינויים' : 'שמירת טיוטה'}</button>
      </PageHead>

      <div className="grid gap-4 lg:grid-cols-[minmax(320px,420px)_1fr]">
        <section className={`card p-4 ${view === 'preview' ? 'hidden lg:block' : ''}`}>
          <div className="mb-4 flex flex-wrap gap-1" role="tablist">
            {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === t ? 'bg-ink text-white' : 'text-muted hover:bg-paper'}`}>{t}</button>)}
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
              <Field label="כתובת ההזמנה" hint="שינוי הכתובת שובר קישורים שכבר נשלחו.">
                <input className="field" dir="ltr" value={draft.slug} onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} /></Field>
            </>}
            {tab === 'מועד' && <>
              <Field label="תאריך לועזי"><input className="field" type="date" value={draft.event_date ?? ''} onChange={(e) => {
                const v = e.target.value || null;
                setDraft((d) => ({ ...d, event_date: v, weekday_label: v ? weekdayLabel(v) : d.weekday_label, hebrew_date: v ? hebrewDate(v) : d.hebrew_date }));
              }} /></Field>
              {text('weekday_label', 'יום בשבוע')}
              <Field label="תאריך עברי" hint="מחושב מהתאריך הלועזי, ואפשר לערוך ידנית.">
                <div className="flex gap-2"><input className="field" value={draft.hebrew_date ?? ''} onChange={(e) => set('hebrew_date', e.target.value)} />
                  <button type="button" className="btn btn-ghost" disabled={!draft.event_date} onClick={() => draft.event_date && set('hebrew_date', hebrewDate(draft.event_date))}>חישוב</button></div></Field>
              <div className="grid grid-cols-3 gap-2">
                <Field label="קבלת פנים"><input className="field" type="time" value={draft.reception_time ?? ''} onChange={(e) => set('reception_time', e.target.value || null)} /></Field>
                <Field label="טקס"><input className="field" type="time" value={draft.ceremony_time ?? ''} onChange={(e) => set('ceremony_time', e.target.value || null)} /></Field>
                <Field label="סיום"><input className="field" type="time" value={draft.end_time ?? ''} onChange={(e) => set('end_time', e.target.value || null)} /></Field>
              </div>
            </>}
            {tab === 'מקום' && <>
              {text('venue_name', 'שם המקום')}
              {text('address', 'כתובת מלאה')}
              {text('waze_url', 'קישור Waze', { ltr: true, placeholder: 'https://waze.com/ul/...', hint: 'אם יישאר ריק, הניווט ייפתח לפי הכתובת.' })}
              {text('gmaps_url', 'קישור Google Maps', { ltr: true, placeholder: 'https://maps.app.goo.gl/...' })}
              {text('contact_phone', 'טלפון ליצירת קשר', { ltr: true })}
              {text('directions', 'הוראות הגעה', { area: true })}
              {text('parking', 'חניה', { area: true })}
              {text('extra_info', 'מידע נוסף על האירוע', { area: true })}
              <div className="grid gap-2 border-t border-line pt-3">
                <span className="label">כפתורים בהזמנה</span>
                {(['navigate', 'calendar', 'call'] as const).map((k) => (
                  <div key={k} className="flex items-center gap-2">
                    <input type="checkbox" aria-label={`הצגת כפתור ${design.labels[k]}`} checked={design.buttons[k]} onChange={(e) => setDesign({ buttons: { ...design.buttons, [k]: e.target.checked } })} />
                    <input className="field" maxLength={30} value={design.labels[k]} onChange={(e) => setDesign({ labels: { ...design.labels, [k]: e.target.value } })} />
                  </div>
                ))}
              </div>
            </>}
            {tab === 'תמונות' && <>
              <span className="label">תמונה ראשית</span>
              {drop('hero', draft.hero_url ? 'החלפת התמונה הראשית' : 'העלאת תמונה ראשית')}
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
            {tab === 'טיפוגרפיה' && <>
              <Field label="פונט אחיד לכל ההזמנה" hint="מחליף את הפונט בכל הטקסטים, הכפתורים והטופס בבת אחת.">
                <select className="field" data-testid="font" value={design.font} onChange={(e) => setDesign(applyFont(design, e.target.value))}>
                  {HEBREW_FONTS.map((f, i) => <option key={f} value={f}>{f}{i ? '' : ' (מומלץ)'}</option>)}</select></Field>
              <Field label="פינות הכפתורים והשדות"><select className="field" value={design.corners} onChange={(e) => setDesign({ corners: e.target.value as Design['corners'] })}>
                <option value="soft">מעוגלות בעדינות</option><option value="sharp">חדות</option><option value="pill">עגולות לגמרי</option></select></Field>
              <Range label="מרווח בין חלקי ההזמנה" value={design.spacing} min={0.6} max={1.6} step={0.05} onChange={(n) => setDesign({ spacing: n })} suffix="×" />
              <p className="border-t border-line pt-3 text-xs text-muted">כוונון עדין לכל סוג טקסט בנפרד:</p>
              <div className="flex flex-wrap gap-1">{STYLE_KEYS.map((s) => <button key={s.key} type="button" onClick={() => setStyleKey(s.key)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${styleKey === s.key ? 'bg-ink text-white' : 'bg-paper'}`}>{s.label}</button>)}</div>
              <Range label="גודל" value={st.size} min={12} max={96} step={1} onChange={(n) => setStyle({ size: n })} suffix="px" />
              <Range label="עובי" value={st.weight} min={100} max={900} step={100} onChange={(n) => setStyle({ weight: n })} />
              <Range label="מרווח אותיות" value={st.spacing} min={-0.05} max={0.4} step={0.01} onChange={(n) => setStyle({ spacing: n })} suffix="em" />
              <Range label="גובה שורה" value={st.lineHeight} min={0.9} max={2.2} step={0.05} onChange={(n) => setStyle({ lineHeight: n })} />
              <div className="grid grid-cols-2 gap-2">
                <Field label="יישור"><select className="field" value={st.align} onChange={(e) => setStyle({ align: e.target.value as TextStyle['align'] })}><option value="center">מרכז</option><option value="right">ימין</option><option value="left">שמאל</option></select></Field>
                <Field label="צבע"><input className="field !p-1" type="color" value={st.color} onChange={(e) => setStyle({ color: e.target.value })} /></Field>
              </div>
            </>}
            {tab === 'צבעים' && <>
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
              <div className="grid gap-3 border-t border-line pt-3">
                <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={design.fall.enabled} onChange={(e) => setDesign({ fall: { ...design.fall, enabled: e.target.checked } })} />אלמנטים שנופלים מהתמונה</label>
                <Field label="סוג האלמנט"><select className="field" value={design.fall.kind} onChange={(e) => setDesign({ fall: { ...design.fall, kind: e.target.value as ParticleKind } })}>{KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select></Field>
                <Range label="כמות" value={design.fall.count} min={4} max={80} step={1} onChange={(n) => setDesign({ fall: { ...design.fall, count: n } })} />
                <Range label="מהירות" value={design.fall.speed} min={0.3} max={2.5} step={0.1} onChange={(n) => setDesign({ fall: { ...design.fall, speed: n } })} suffix="×" />
                <Range label="עוצמה" value={design.fall.intensity} min={0.2} max={1} step={0.05} onChange={(n) => setDesign({ fall: { ...design.fall, intensity: n } })} />
                <Range label="משך (0 = ללא הפסקה)" value={design.fall.duration} min={0} max={30} step={1} onChange={(n) => setDesign({ fall: { ...design.fall, duration: n } })} suffix=" שנ׳" />
                <div><span className="label">צבעי האלמנטים</span><div className="flex gap-2">{design.fall.colors.map((c, i) => <input key={i} type="color" aria-label={`צבע ${i + 1}`} className="h-9 w-12 rounded border border-line" value={c} onChange={(e) => setDesign({ fall: { ...design.fall, colors: design.fall.colors.map((x, j) => (j === i ? e.target.value : x)) } })} />)}</div></div>
              </div>
              <div className="grid gap-3 border-t border-line pt-3">
                <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={design.celebrate.enabled} onChange={(e) => setDesign({ celebrate: { ...design.celebrate, enabled: e.target.checked } })} />חגיגה אחרי אישור הגעה</label>
                <p className="text-xs text-muted">האפקט מופעל רק אחרי שהתשובה נשמרה בשרת.</p>
                <Field label="סוג האלמנט"><select className="field" value={design.celebrate.kind} onChange={(e) => setDesign({ celebrate: { ...design.celebrate, kind: e.target.value as ParticleKind } })}>{KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select></Field>
                <Range label="כמות" value={design.celebrate.count} min={20} max={300} step={10} onChange={(n) => setDesign({ celebrate: { ...design.celebrate, count: n } })} />
                <Range label="משך" value={design.celebrate.duration} min={1} max={10} step={0.5} onChange={(n) => setDesign({ celebrate: { ...design.celebrate, duration: n } })} suffix=" שנ׳" />
                <button type="button" className="btn btn-ghost" onClick={() => { setView('preview'); setCelebrate((n) => n + 1); }}>הפעלת החגיגה בתצוגה המקדימה</button>
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
        </section>

        <section className={`card overflow-hidden ${view === 'edit' ? 'hidden lg:block' : ''}`}>
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-sm font-semibold text-muted">תצוגה מקדימה חיה</span>
            <div className="flex gap-1">{DEVICES.map((d) => <button key={d.key} onClick={() => setDevice(d)} aria-pressed={device.key === d.key} className={`rounded-lg px-3 py-1 text-sm font-semibold ${device.key === d.key ? 'bg-ink text-white' : 'hover:bg-paper'}`}>{d.label}</button>)}</div>
          </div>
          <div ref={pane} className="h-[78dvh] overflow-hidden bg-[#dfe3ea]" data-testid="preview-pane">
            <div data-testid="preview-frame" style={{ width: device.w, height: `calc(78dvh / ${scale})`, transform: `scale(${scale})`, transformOrigin: 'top right', marginInlineStart: Math.max(0, (paneW - device.w * scale) / 2), overflowY: 'auto', position: 'relative' }}>
              <InvitationView data={previewData} preview celebrateKey={celebrate} />
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

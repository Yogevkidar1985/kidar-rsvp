import type { Design, TextStyle } from './types';

export type Palette = { id: string; name: string; mood: string; colors: Design['colors']; fall: string[] };

const pal = (id: string, name: string, mood: string, surface: string, soft: string, ink: string, muted: string, accent: string, line: string): Palette =>
  ({ id, name, mood, colors: { bg: soft, surface, soft, ink, muted, accent, line, button: ink, buttonText: surface }, fall: [accent, line, '#FFFFFF', muted] });

/** Five designed palettes: background, secondary background, text, secondary text, accent, borders. */
export const PALETTES: Palette[] = [
  pal('champagne', 'שמפניה ושנהב', 'חם, אלגנטי, על-זמני', '#F8F5EF', '#F1EBE2', '#40352F', '#8C796D', '#B7A08C', '#D9CABC'),
  pal('powder', 'תכלת אבקתי', 'עדין, רגוע, מודרני', '#F7F9FA', '#EAF0F4', '#354653', '#778C9A', '#A8BFCE', '#D6E0E6'),
  pal('sage', 'מרווה וחול', 'טבעי, אורגני, מעודן', '#F7F7F1', '#EBEEE6', '#41493F', '#83907E', '#A6B19B', '#D9DED3'),
  pal('silver', 'לבן וכסף', 'נקי, מינימלי, עכשווי', '#FFFFFF', '#F5F5F3', '#363636', '#888888', '#B6B6B0', '#E5E5E2'),
  pal('dusty', 'כחול מאובק ושמפניה', 'חגיגי, יוקרתי, ייחודי', '#F8F6F2', '#E9EEF1', '#394957', '#8397A4', '#C2A77E', '#D9DFE3'),
];

/** Hebrew families offered as the single invitation font. The first is the default. */
export const HEBREW_FONTS = ['Heebo', 'Assistant', 'Noto Sans Hebrew', 'Rubik'];

const t = (font: string, size: number, weight: number, color: string, extra: Partial<TextStyle> = {}): TextStyle =>
  ({ font, size, weight, spacing: 0, lineHeight: 1.3, align: 'center', color, ...extra });

/** The whole type system in one family: hierarchy comes from size, weight and spacing only. */
export function typeSystem(font: string, ink: string): Design['styles'] {
  return {
    headline: t(font, 40, 300, ink, { lineHeight: 1.15 }),
    hosts: t(font, 28, 500, ink, { lineHeight: 1.25 }),
    body: t(font, 18, 400, ink, { lineHeight: 1.8 }),
    date: t(font, 17, 400, ink, { spacing: 0.01, lineHeight: 1.5 }),
  };
}

const P0 = PALETTES[0];
export const DEFAULT_DESIGN: Design = {
  palette: P0.id,
  colors: P0.colors,
  font: HEBREW_FONTS[0],
  latin: '', latinFont: HEBREW_FONTS[0],
  spacing: 1,
  saved: [], corners: 'soft',
  styles: typeSystem(HEBREW_FONTS[0], P0.colors.ink),
  heroShape: 'full',
  labels: { rsvp: 'אישור הגעה', rsvpTitle: 'נשמח לראותכם!', navigate: 'ניווט', calendar: 'הוספה ליומן', call: 'חיוג' },
  buttons: { navigate: true, calendar: true, call: true },
  entrance: true,
  fall: { enabled: true, kind: 'confetti', speed: 0.7, intensity: 0.7, count: 22, duration: 0, colors: P0.fall },
  celebrate: { enabled: true, kind: 'confetti', count: 140, duration: 4 },
  extras: { sparkle: true, countdown: true },
};

/** Colours, text colours and falling-piece colours of a palette, as one design patch. */
export function applyPalette(d: Design, p: Palette): Partial<Design> {
  const styles = Object.fromEntries(Object.entries(d.styles).map(([k, s]) => [k, { ...s, color: p.colors.ink }])) as Design['styles'];
  return { palette: p.id, colors: p.colors, styles, fall: { ...d.fall, colors: p.fall } };
}
/** One family for every text style and for the interface. */
export function applyFont(d: Design, font: string): Partial<Design> {
  const styles = Object.fromEntries(Object.entries(d.styles).map(([k, s]) => [k, { ...s, font }])) as Design['styles'];
  return { font, latinFont: font, styles };
}
/** The fonts the invitation may load: an older saved design that names another family falls back to the default. */
export const allowedFont = (f: string) => (HEBREW_FONTS.includes(f) ? f : HEBREW_FONTS[0]);

export function resolveDesign(d: Partial<Design> | null | undefined): Design {
  const x = d ?? {};
  const s = (x.styles ?? {}) as Partial<Design['styles']>;
  const r = merge(x, s);
  // one family everywhere: every text style follows the invitation font
  const font = allowedFont(r.font);
  const styles = Object.fromEntries(Object.entries(r.styles).map(([k, v]) => [k, { ...v, font }])) as Design['styles'];
  return { ...r, font, latinFont: font, styles };
}
function merge(x: Partial<Design>, s: Partial<Design['styles']>): Design {
  return {
    ...DEFAULT_DESIGN, ...x,
    colors: { ...DEFAULT_DESIGN.colors, ...x.colors },
    styles: {
      headline: { ...DEFAULT_DESIGN.styles.headline, ...s.headline },
      hosts: { ...DEFAULT_DESIGN.styles.hosts, ...s.hosts },
      body: { ...DEFAULT_DESIGN.styles.body, ...s.body },
      date: { ...DEFAULT_DESIGN.styles.date, ...s.date },
    },
    labels: { ...DEFAULT_DESIGN.labels, ...x.labels },
    buttons: { ...DEFAULT_DESIGN.buttons, ...x.buttons },
    fall: { ...DEFAULT_DESIGN.fall, ...x.fall },
    celebrate: { ...DEFAULT_DESIGN.celebrate, ...x.celebrate },
    extras: { ...DEFAULT_DESIGN.extras, ...x.extras },
  };
}

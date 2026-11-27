import type { Design, TextStyle } from './types';

export type Palette = { id: string; name: string; mood: string; colors: Design['colors']; fall: string[] };

/** Five designed palettes. `muted` is darkened from the swatch where needed so small text keeps 4.5:1 contrast. */
export const PALETTES: Palette[] = [
  { id: 'champagne', name: 'שמפניה ושנהב', mood: 'חם, אלגנטי, על-זמני',
    colors: { bg: '#E7DCCB', surface: '#F8F5EF', soft: '#EFE8DC', ink: '#51463D', muted: '#7A6A5B', accent: '#A99683', button: '#51463D', buttonText: '#F8F5EF' },
    fall: ['#FFFFFF', '#E7DCCB', '#D8C7B3', '#C9B59C'] },
  { id: 'powder', name: 'תכלת אבקתי', mood: 'עדין, רגוע, מודרני',
    colors: { bg: '#DCE8EF', surface: '#FAF8F4', soft: '#EDF3F6', ink: '#354B5C', muted: '#587183', accent: '#718B9D', button: '#354B5C', buttonText: '#FAF8F4' },
    fall: ['#FFFFFF', '#DCE8EF', '#B9CEDB', '#9DB6C6'] },
  { id: 'sage', name: 'מרווה וחול', mood: 'טבעי, אורגני, מעודן',
    colors: { bg: '#DCE3D7', surface: '#F6F7F2', soft: '#E9DFD1', ink: '#4C514A', muted: '#66705E', accent: '#87927E', button: '#4C514A', buttonText: '#F6F7F2' },
    fall: ['#FFFFFF', '#DCE3D7', '#C2CDB9', '#E9DFD1'] },
  { id: 'silver', name: 'לבן וכסף', mood: 'נקי, מינימלי, עכשווי',
    colors: { bg: '#E7E8E8', surface: '#FFFFFF', soft: '#F4F4F2', ink: '#424242', muted: '#6F6F6B', accent: '#A7A7A2', button: '#424242', buttonText: '#FFFFFF' },
    fall: ['#FFFFFF', '#E7E8E8', '#D2D3D3', '#BDBDB9'] },
  { id: 'dusty', name: 'כחול מאובק וזהב', mood: 'חגיגי, יוקרתי, ייחודי',
    colors: { bg: '#AEBFCC', surface: '#F8F5EF', soft: '#E7EDF1', ink: '#465563', muted: '#627080', accent: '#C4A878', button: '#465563', buttonText: '#F8F5EF' },
    fall: ['#FFFFFF', '#E7EDF1', '#C4A878', '#AEBFCC'] },
];

/** Hebrew families offered as the single invitation font. */
export const HEBREW_FONTS = ['Frank Ruhl Libre', 'David Libre', 'Heebo', 'Assistant', 'Noto Sans Hebrew'];

const t = (font: string, size: number, weight: number, color: string, extra: Partial<TextStyle> = {}): TextStyle =>
  ({ font, size, weight, spacing: 0, lineHeight: 1.3, align: 'center', color, ...extra });

/** The whole type system in one family: hierarchy comes from size, weight and spacing only. */
export function typeSystem(font: string, ink: string): Design['styles'] {
  return {
    headline: t(font, 46, 400, ink, { lineHeight: 1.12 }),
    hosts: t(font, 26, 500, ink, { lineHeight: 1.25 }),
    body: t(font, 18, 400, ink, { lineHeight: 1.75 }),
    date: t(font, 17, 400, ink, { spacing: 0.02, lineHeight: 1.5 }),
  };
}

const P0 = PALETTES[0];
export const DEFAULT_DESIGN: Design = {
  palette: P0.id,
  colors: P0.colors,
  font: HEBREW_FONTS[0],
  latin: '', latinFont: 'Cormorant Garamond',
  spacing: 1,
  styles: typeSystem(HEBREW_FONTS[0], P0.colors.ink),
  heroShape: 'arch',
  labels: { rsvp: 'אישור הגעה', rsvpTitle: 'נשמח לראותכם!', navigate: 'ניווט', calendar: 'הוספה ליומן', call: 'חיוג' },
  buttons: { navigate: true, calendar: true, call: true },
  entrance: true,
  fall: { enabled: true, kind: 'feathers', speed: 0.8, intensity: 0.7, count: 18, duration: 0, colors: P0.fall },
  celebrate: { enabled: true, kind: 'confetti', count: 140, duration: 4 },
};

/** Colours, text colours and falling-piece colours of a palette, as one design patch. */
export function applyPalette(d: Design, p: Palette): Partial<Design> {
  const styles = Object.fromEntries(Object.entries(d.styles).map(([k, s]) => [k, { ...s, color: p.colors.ink }])) as Design['styles'];
  return { palette: p.id, colors: p.colors, styles, fall: { ...d.fall, colors: p.fall } };
}
/** One family for every text style and for the interface. */
export function applyFont(d: Design, font: string): Partial<Design> {
  const styles = Object.fromEntries(Object.entries(d.styles).map(([k, s]) => [k, { ...s, font }])) as Design['styles'];
  return { font, styles };
}

export function resolveDesign(d: Partial<Design> | null | undefined): Design {
  const x = d ?? {};
  const s = (x.styles ?? {}) as Partial<Design['styles']>;
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
  };
}

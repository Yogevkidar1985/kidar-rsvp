import type { Design, TextStyle } from './types';

const t = (font: string, size: number, weight: number, color: string, extra: Partial<TextStyle> = {}): TextStyle =>
  ({ font, size, weight, spacing: 0, lineHeight: 1.3, align: 'center', color, ...extra });

export const DEFAULT_DESIGN: Design = {
  colors: { bg: '#EEF2F6', surface: '#FBFCFD', ink: '#1E2A44', muted: '#6A778E', accent: '#A8834B', button: '#1E2A44', buttonText: '#FFFFFF' },
  styles: {
    headline: t('Bellefair', 58, 400, '#1E2A44', { lineHeight: 1.05 }),
    hosts: t('Bellefair', 30, 400, '#1E2A44', { lineHeight: 1.2 }),
    body: t('Assistant', 18, 400, '#465269', { lineHeight: 1.65 }),
    date: t('Frank Ruhl Libre', 22, 500, '#1E2A44', { spacing: 0.02 }),
  },
  heroShape: 'arch',
  labels: { rsvp: 'לאישור הגעה לחצו כאן', navigate: 'ניווט', calendar: 'הוספה ליומן', call: 'חיוג' },
  buttons: { navigate: true, calendar: true, call: true },
  entrance: true,
  fall: { enabled: true, kind: 'feathers', speed: 1, intensity: 0.8, count: 26, duration: 0, colors: ['#FFFFFF', '#C9D8E8', '#A9BFD6', '#E3D2B4'] },
  celebrate: { enabled: true, kind: 'confetti', count: 140, duration: 4 },
};

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

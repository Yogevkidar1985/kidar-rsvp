export type FontDef = { name: string; group: string; weights: string; fallback: string };

export const FONTS: FontDef[] = [
  { name: 'Bellefair', group: 'אלגנטי להזמנות', weights: '400', fallback: 'serif' },
  { name: 'Frank Ruhl Libre', group: 'סריף קלאסי', weights: '300..900', fallback: 'serif' },
  { name: 'David Libre', group: 'סריף קלאסי', weights: '400;500;700', fallback: 'serif' },
  { name: 'Noto Serif Hebrew', group: 'סריף קלאסי', weights: '100..900', fallback: 'serif' },
  { name: 'Tinos', group: 'סריף קלאסי', weights: '400;700', fallback: 'serif' },
  { name: 'Suez One', group: 'סריף קלאסי', weights: '400', fallback: 'serif' },
  { name: 'Assistant', group: 'סנס מודרני', weights: '200..800', fallback: 'sans-serif' },
  { name: 'Heebo', group: 'סנס מודרני', weights: '100..900', fallback: 'sans-serif' },
  { name: 'Rubik', group: 'סנס מודרני', weights: '300..900', fallback: 'sans-serif' },
  { name: 'Alef', group: 'סנס מודרני', weights: '400;700', fallback: 'sans-serif' },
  { name: 'Noto Sans Hebrew', group: 'סנס מודרני', weights: '100..900', fallback: 'sans-serif' },
  { name: 'IBM Plex Sans Hebrew', group: 'סנס מודרני', weights: '300;400;500;600;700', fallback: 'sans-serif' },
  { name: 'Varela Round', group: 'סנס מודרני', weights: '400', fallback: 'sans-serif' },
  { name: 'Secular One', group: 'סנס מודרני', weights: '400', fallback: 'sans-serif' },
  { name: 'Karantina', group: 'כותרות', weights: '300;400;700', fallback: 'sans-serif' },
  { name: 'Amatic SC', group: 'כתב יד', weights: '400;700', fallback: 'cursive' },
  { name: 'Solitreo', group: 'כתב יד', weights: '400', fallback: 'cursive' },
  { name: 'Playpen Sans Hebrew', group: 'כתב יד', weights: '100..800', fallback: 'cursive' },
  { name: 'Cormorant Garamond', group: 'English · Serif', weights: '300..700', fallback: 'serif' },
  { name: 'Playfair Display', group: 'English · Serif', weights: '400..900', fallback: 'serif' },
  { name: 'Lora', group: 'English · Serif', weights: '400..700', fallback: 'serif' },
  { name: 'Cinzel', group: 'English · Serif', weights: '400..900', fallback: 'serif' },
  { name: 'Montserrat', group: 'English · Sans', weights: '100..900', fallback: 'sans-serif' },
  { name: 'Josefin Sans', group: 'English · Sans', weights: '100..700', fallback: 'sans-serif' },
  { name: 'Great Vibes', group: 'English · Script', weights: '400', fallback: 'cursive' },
  { name: 'Dancing Script', group: 'English · Script', weights: '400..700', fallback: 'cursive' },
  { name: 'Parisienne', group: 'English · Script', weights: '400', fallback: 'cursive' },
];

const byName = new Map(FONTS.map((f) => [f.name, f]));

export function fontStack(name: string): string {
  const f = byName.get(name);
  return `"${name}", "Assistant", ${f?.fallback ?? 'sans-serif'}`;
}

/** Google Fonts stylesheet URL for a set of families from the library. Unknown names are ignored. */
export function fontsHref(names: string[]): string | null {
  const fams = [...new Set(names)].map((n) => byName.get(n)).filter((f): f is FontDef => !!f);
  if (!fams.length) return null;
  const q = fams.map((f) => `family=${f.name.replace(/ /g, '+')}${f.weights === '400' ? '' : `:wght@${f.weights}`}`).join('&');
  return `https://fonts.googleapis.com/css2?${q}&display=swap`;
}

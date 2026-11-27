/**
 * A photo in the width the screen needs. Uploaded photos are kept at full size in storage; a phone showing one
 * as a small card should not download all of it. Next's image optimizer resizes and caches each width once.
 * Anything that is not an uploaded photo (a file of the site itself, a data address) is returned as it is.
 */
export const IMG = { thumb: 384, card: 640, full: 1080 } as const;
export function img(url: string | null | undefined, w: number): string {
  if (!url) return '';
  return /^https?:\/\/[^/]+\/storage\/v1\/object\/public\//.test(url) ? `/_next/image?url=${encodeURIComponent(url)}&w=${w}&q=75` : url;
}
/** Two widths for a small card, so a sharp screen gets the sharper one. */
export const cardSet = (url: string) => (img(url, IMG.thumb) === url ? undefined : `${img(url, IMG.thumb)} 384w, ${img(url, IMG.card)} 640w`);

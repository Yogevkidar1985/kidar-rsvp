/** Mirrors public.norm_phone in the database. */
export function normPhone(p: string | null | undefined): string | null {
  if (!p) return null;
  let d = p.replace(/\D/g, '');
  if (d.startsWith('972')) d = '0' + d.slice(3);
  return d.length < 9 || d.length > 15 ? null : d;
}
/** WhatsApp chat id / wa.me number in international format (Israel default). */
export function intlPhone(p: string): string | null {
  const d = normPhone(p);
  if (!d) return null;
  return d.startsWith('0') ? '972' + d.slice(1) : d;
}

/** The invitation's address: lower-case letters, digits and hyphens. The same rule the database enforces. */
export const SLUG = /^[a-z0-9][a-z0-9-]{2,60}$/;
/** A family's link code: the random 8 characters every guest starts with, or a word the owner chose. */
export const LINK_CODE = /^[A-Za-z0-9][A-Za-z0-9-]{3,23}$/;
/** Eight characters nobody can guess. */
export function randomCode(): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
}

/** Tells the server that an event changed, so the public invitation is rebuilt for the next visitor. Never throws. */
export function refreshPublic(eventId: string, was?: string): Promise<void> {
  return fetch('/api/admin/revalidate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId, was }), keepalive: true }).then(() => undefined, () => undefined);
}

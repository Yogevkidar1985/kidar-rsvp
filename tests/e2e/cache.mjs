// The short cache of the public invitation: a visitor may see a change up to half a minute late, unless a save clears it at once.
// usage: node tests/e2e/cache.mjs   (after `npm run build` with the mock's URL and key)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMock, SERVICE, ANON } from './mock-supabase.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = 'http://127.0.0.1:3117', MOCK = 54399;
const results = []; const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mock = await startMock(MOCK, root);
await mock.sql(`update events set published = true, headline = 'כותרת ראשונה' where slug = 'kidar-brit'`);
const [{ id }] = await mock.sql(`select id from events where slug = 'kidar-brit'`);
const [g] = await mock.sql(`insert into guests (event_id, family_name, phone, status) values ($1, 'משפחת מטמון', '0501010101', 'pending') returning link_code`, [id]);
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE, RSVP_HASH_SECRET: 'test', INVITATION_CACHE_SECONDS: '30' };
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3117', '-H', '127.0.0.1'], { cwd: root, env, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { await fetch(APP + '/admin/login'); break; } catch { await sleep(500); } }
const page = async (u = '/kidar-brit') => (await fetch(APP + u)).text();
try {
  check('the invitation is served', (await page()).includes('כותרת ראשונה'));
  await mock.sql(`update events set headline = 'כותרת שנייה' where id = $1`, [id]);
  check('a change made behind the system\'s back waits for the cache', (await page()).includes('כותרת ראשונה'));
  check('a personal link is always read fresh', (await page(`/kidar-brit/${g.link_code}`)).includes('כותרת שנייה'));
  let r = await fetch(APP + '/api/admin/revalidate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId: id }) });
  check('a stranger cannot clear the cache', r.status === 401);
  r = await fetch(APP + '/api/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: '1007' }) });
  const cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  r = await fetch(APP + '/api/admin/revalidate', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ eventId: id }) });
  check('a save clears it', r.status === 200 && (await page()).includes('כותרת שנייה'));
  await mock.sql(`update events set published = false where id = $1`, [id]);
  await fetch(APP + '/api/admin/revalidate', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ eventId: id }) });
  check('unpublishing takes the invitation down at once', (await fetch(APP + '/kidar-brit')).status === 404);
} catch (e) { check('the run completed', false, e?.stack ?? String(e)); }
finally { app.kill(); await mock.close?.(); }
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);

// The WhatsApp connection entered from the admin screen: who may save it, that the token never comes back,
// and that a saved connection is what sends. A stand-in plays Green API; no message leaves this machine.
// usage: node tests/e2e/green.mjs   (after `npm run build` with the mock's URL and key)
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMock, SERVICE, ANON } from './mock-supabase.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = 'http://127.0.0.1:3114', MOCK = 54399, GREEN = 54396;
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra && !ok ? '  — ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const outbox = []; const seen = [];
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  seen.push(req.url);
  res.writeHead(200, { 'content-type': 'application/json' });
  if (req.url.includes('/getStateInstance/')) return res.end(JSON.stringify({ stateInstance: 'authorized' }));
  const b = JSON.parse(Buffer.concat(chunks).toString());
  outbox.push({ to: b.chatId, text: b.message });
  res.end(JSON.stringify({ idMessage: 'msg' + outbox.length }));
}).listen(GREEN, '127.0.0.1');

const mock = await startMock(MOCK, root);
const sql = mock.sql;
await sql(`update events set published = true where slug = 'kidar-brit'`);
const [{ id: eventId }] = await sql(`select id from events where slug = 'kidar-brit'`);
const TOKEN = 'abcdef0123456789abcdef0123456789abcdef0123456789';

// no connection in the environment: the screen is the only source
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE, RSVP_HASH_SECRET: 'test', INVITATION_CACHE_SECONDS: '0',
  GREEN_API_INSTANCE_ID: '', GREEN_API_TOKEN: '', GREEN_API_URL: '', NEXT_PUBLIC_SITE_URL: 'https://invite.example', NODE_USE_ENV_PROXY: '', HTTPS_PROXY: '', https_proxy: '', HTTP_PROXY: '', http_proxy: '' };
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3114', '-H', '127.0.0.1'], { cwd: root, env, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { await fetch(APP + '/admin/login'); break; } catch { await sleep(500); } }

let cookie = '';
const call = async (method, url, body, withCookie = true) => {
  const r = await fetch(APP + url, { method, headers: { 'Content-Type': 'application/json', ...(withCookie && cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, res: r };
};

try {
  let r = await call('POST', '/api/admin/green', { eventId, instance: '1101000001', token: TOKEN }, false);
  check('a signed-out caller cannot save a connection', r.status === 401);
  r = await call('GET', `/api/admin/integrations?event=${eventId}`, null, false);
  check('a signed-out caller cannot read the connection state', r.status === 401);
  r = await call('POST', '/api/unlock', { code: '1007' }, false);
  cookie = (r.res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  check('the passcode opens a session', r.json?.ok === true);

  r = await call('GET', `/api/admin/integrations?event=${eventId}`);
  check('nothing is connected at first', r.json?.ok && r.json.greenApiConfigured === false);
  r = await call('POST', '/api/admin/green', { eventId, instance: 'abc', token: 'short' });
  check('malformed details are refused', r.status === 400);
  r = await call('POST', '/api/admin/green', { eventId, instance: '1101000001', token: TOKEN, url: `http://127.0.0.1:${GREEN}` });
  check('an address outside green-api.com is refused, and nothing is called', r.status === 400 && seen.length === 0, JSON.stringify(r.json));
  r = await call('POST', '/api/admin/green', { eventId, instance: '1101000001', token: TOKEN, url: 'https://green-api.com.evil.example' });
  check('a look-alike host is refused', r.status === 400 && seen.length === 0);
  r = await call('POST', '/api/admin/green', { eventId, instance: '1101000001', token: TOKEN, url: 'https://evilgreenapi.com' });
  check('a host that only ends like Green API is refused', r.status === 400 && /למשל/.test(r.json?.message ?? ''), JSON.stringify(r.json));
  r = await call('POST', '/api/admin/green', { eventId, instance: '1101000001', token: TOKEN, url: 'https://7107.api.greenapi.com/' });
  check('an instance address on greenapi.com passes the address check', !/למשל/.test(r.json?.message ?? ''), JSON.stringify(r.json));
  check('nothing was stored by the refused attempts', (await sql(`select count(*)::int n from event_secrets`))[0].n === 0);

  // a queued message waits while nothing is connected
  await sql(`insert into integrations (event_id, type, name, config) values ($1, 'greenapi', 'WhatsApp', '{"recipients":[{"name":"בעלים","phone":"0500000001"}]}')`, [eventId]);
  const [g] = await sql(`insert into guests (event_id, family_name, phone, status) values ($1, 'משפחת בדיקה', '0501234567', 'pending') returning id`, [eventId]);
  r = await call('POST', '/api/admin/campaigns', { eventId, kind: 'invite', name: 'בדיקה', body: 'שלום {{guest_name}} {{invitation_url}}', guestIds: [g.id] });
  check('a campaign can be queued before WhatsApp is connected', r.json?.queued === 1, JSON.stringify(r.json));
  r = await call('POST', '/api/cron/tick', {}, false);
  check('the queue waits and sends nothing', r.json?.waiting === true && outbox.length === 0 && (await sql(`select status from messages`))[0].status === 'pending', JSON.stringify(r.json));

  // the connection as the server stores it (the stand-in's address is written directly: the screen only accepts green-api.com)
  await sql(`insert into event_secrets (event_id, green_instance, green_token, green_url) values ($1, '1101000001', $2, $3)`, [eventId, TOKEN, `http://127.0.0.1:${GREEN}`]);
  r = await call('GET', `/api/admin/integrations?event=${eventId}&check=1`);
  check('the state shows a connection saved from the screen, linked to a phone', r.json?.greenApiConfigured === true && r.json.source === 'db' && r.json.state === 'authorized', JSON.stringify(r.json));
  check('the token never comes back', !r.text.includes(TOKEN) && !r.text.includes('1101000001'));
  const pub = await fetch(`http://127.0.0.1:${MOCK}/rest/v1/event_secrets?select=*`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } });
  const pubRows = pub.ok ? await pub.json() : [];
  check('the public key cannot read the stored connection', !pub.ok || pubRows.length === 0);
  const own = await fetch(`http://127.0.0.1:${MOCK}/rest/v1/event_secrets?select=*`, { headers: { apikey: ANON, cookie, Authorization: `Bearer ${(cookie.match(/auth-token[^=]*=([^;]+)/) ?? [])[1] ?? ANON}` } });
  check('even a signed-in browser cannot read it', !own.ok || (await own.json()).length === 0);

  for (let i = 0; i < 4; i++) await call('POST', '/api/cron/tick', {}, false);
  check('the waiting invitation goes out through the saved connection', outbox.length === 1 && outbox[0].to === '972501234567@c.us' && seen.some((u) => u.includes('/waInstance1101000001/sendMessage/')), JSON.stringify(outbox));
  const before = outbox.length;
  r = await call('POST', '/api/rsvp', { slug: 'kidar-brit', name: 'משפחת ישראלי', phone: '0507654321', status: 'attending', adults: 2, children: 0, babies: 0 }, false);
  const got = () => outbox.slice(before).some((m) => m.to === '972500000001@c.us' && m.text.includes('ישראלי'));
  for (let i = 0; i < 20 && !got(); i++) await sleep(250);
  check('an answer on the invitation reaches the owner on WhatsApp', got(), `${r.status} ${JSON.stringify(outbox.slice(before))}`);

  r = await call('DELETE', `/api/admin/green?event=${eventId}`);
  check('disconnecting removes the stored connection', r.json?.ok && (await sql(`select count(*)::int n from event_secrets`))[0].n === 0);
  r = await call('GET', `/api/admin/integrations?event=${eventId}`);
  check('and the state goes back to not connected', r.json?.greenApiConfigured === false);
} catch (e) { check('the run completed', false, e?.stack ?? String(e)); }
finally { app.kill(); await mock.close?.(); }
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);

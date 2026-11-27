// Renders the link preview picture from the mock database, with and without a photograph.
// usage: node tests/e2e/og.mjs <photos dir> <out dir>
import { spawn } from 'node:child_process';
import http from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMock, SERVICE, ANON } from './mock-supabase.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [photos, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IMG = 54396, MOCK = 54399, APP = 'http://127.0.0.1:3114';
http.createServer((q, s) => { try { s.writeHead(200, { 'content-type': 'image/jpeg' }); s.end(readFileSync(path.join(photos, path.basename(q.url)))); } catch { s.writeHead(404); s.end(); } }).listen(IMG);
const mock = await startMock(MOCK, root);
await mock.sql(`update events set published = true, hosts = 'יוגב ואביה קידר', headline = 'נולד לנו בן', design = '{"latin":"AVIYA & YOGEV KIDAR"}' where slug = 'kidar-brit'`);
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE, RSVP_HASH_SECRET: 'test', INVITATION_CACHE_SECONDS: '0', NODE_USE_ENV_PROXY: '', HTTPS_PROXY: '', https_proxy: '', HTTP_PROXY: '', http_proxy: '' };
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3114', '-H', '127.0.0.1'], { cwd: root, env, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { await fetch(APP + '/admin/login'); break; } catch { await sleep(500); } }
try {
  const shot = async (name) => {
    const r = await fetch(`${APP}/og/kidar-brit`);
    const buf = Buffer.from(await r.arrayBuffer());
    writeFileSync(path.join(out, name), buf);
    console.log(name, r.status, r.headers.get('content-type'), buf.length, 'bytes');
  };
  await shot('og-text.png');
  await mock.sql(`update events set hero_url = $1 where slug = 'kidar-brit'`, [`http://127.0.0.1:${IMG}/1.jpg`]);
  await shot('og-photo.png');
  const html = await (await fetch(`${APP}/kidar-brit`, { headers: { 'x-forwarded-host': 'invite.example', 'x-forwarded-proto': 'https' } })).text();
  console.log('meta:', (html.match(/<meta property="og:(image|title|description)"[^>]*>/g) ?? []).join(' ').slice(0, 420));
  console.log('unknown event:', (await fetch(`${APP}/og/nope-nope`)).status, '| unpublished is hidden:', await (async () => { await mock.sql(`update events set published = false`); return (await fetch(`${APP}/og/kidar-brit`)).status; })());
} finally { app.kill(); process.exit(0); }

// Visual review: serves the invitation from the mock database and photographs it on a phone and a desktop.
// usage: node tests/e2e/review.mjs <photos dir> <out dir> [design JSON to merge]
import { spawn } from 'node:child_process';
import http from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { startMock, SERVICE, ANON } from './mock-supabase.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [photos, out, palette = ''] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IMG = 54398, MOCK = 54399, APP = 'http://127.0.0.1:3112';
http.createServer((q, s) => { try { s.writeHead(200, { 'content-type': 'image/jpeg' }); s.end(readFileSync(path.join(photos, path.basename(q.url)))); } catch { s.writeHead(404); s.end(); } }).listen(IMG);
const mock = await startMock(MOCK, root);
const img = (n) => `http://127.0.0.1:${IMG}/${n}.jpg`;
const design = { latin: 'AVIYA & YOGEV KIDAR' };
await mock.sql(`update events set published = true, venue_name = 'אולם הדוגמה', address = 'הרצל 1, כפר סבא', contact_phone = '050-0000000', parking = 'חניה חינם בחניון האולם.',
  hero_url = $1, design = $2, headline = 'נולד לנו בן',
  intro_text = E'בשעה טובה, זכינו להרחיב את המשפחה.\nהנכם מוזמנים לחגוג ולהתרגש עימנו\nבמסיבת הברית של בננו.\nנוכחותכם תשמח אותנו.',
  closing_text = 'מחכים לראותכם,', hosts = 'יוגב ואביה קידר' where slug = 'kidar-brit'`, [img(1), JSON.stringify(design)]);
await mock.sql(`insert into media_assets (event_id, kind, url, sort) select id, k, u, s from events, (values ('gallery', $1, 0), ('gallery', $2, 1), ('gallery', $3, 2), ('venue', $3, 0)) v(k, u, s) where slug = 'kidar-brit'`, [img(2), img(3), img(4)]);
if (palette) await mock.sql(`update events set design = $1 where slug = 'kidar-brit'`, [JSON.stringify({ ...design, ...JSON.parse(palette) })]);
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE, RSVP_HASH_SECRET: 'test', NODE_USE_ENV_PROXY: '', HTTPS_PROXY: '', https_proxy: '', HTTP_PROXY: '', http_proxy: '' };
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3112', '-H', '127.0.0.1'], { cwd: root, env, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { await fetch(APP + '/admin/login'); break; } catch { await sleep(500); } }
const { chromium, devices } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ args: ['--no-proxy-server'] });
try {
  const scrollAll = (page) => page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 300) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 140)); } window.scrollTo(0, 0); await new Promise((r) => setTimeout(r, 900)); });
  const phone = await (await browser.newContext({ ...devices['iPhone 13'], locale: 'he-IL' })).newPage();
  const errs = []; phone.on('pageerror', (e) => errs.push(e.message));
  await phone.goto(`${APP}/e/kidar-brit`, { waitUntil: 'networkidle' });
  await sleep(1500);
  await phone.screenshot({ path: path.join(out, 'phone-top.png') });
  await scrollAll(phone);
  await phone.screenshot({ path: path.join(out, 'phone-full.png'), fullPage: true });
  console.log('overflow-x:', await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth));
  console.log('fonts:', await phone.evaluate(() => [...new Set([...document.querySelectorAll('.inv *')].map((e) => getComputedStyle(e).fontFamily.split(',')[0]))].join(' | ')));
  await phone.click('[data-testid=rsvp-open]'); await phone.waitForSelector('.sheet form'); await sleep(500);
  await phone.screenshot({ path: path.join(out, 'phone-rsvp.png') });
  await phone.fill('input[name=name]', 'ישראל ישראלי'); await phone.fill('input[name=phone]', '0501234567');
  await phone.click('.sheet button[type=submit]'); await phone.waitForSelector('[data-testid=rsvp-success]'); await sleep(1300);
  await phone.screenshot({ path: path.join(out, 'phone-thanks.png') });
  console.log('saved:', JSON.stringify(await mock.sql(`select family_name, status, adults from guests`)));
  const desk = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'he-IL' })).newPage();
  await desk.goto(`${APP}/e/kidar-brit`, { waitUntil: 'networkidle' }); await sleep(1200);
  await desk.screenshot({ path: path.join(out, 'desktop-top.png') });
  console.log('errors:', errs.join(' ; ') || 'none');
} finally { await browser.close(); app.kill(); process.exit(0); }

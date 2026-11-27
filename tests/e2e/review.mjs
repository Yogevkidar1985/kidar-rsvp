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
  // test mode: the whole journey on screen, nothing written
  const before = (await mock.sql(`select count(*)::int n from guests`))[0].n, seen = (await mock.sql(`select count(*)::int n from invitation_events`))[0].n;
  const tp = await (await browser.newContext({ ...devices['iPhone 13'], locale: 'he-IL' })).newPage();
  await tp.goto(`${APP}/kidar-brit?test=1`, { waitUntil: 'networkidle' }); await sleep(800);
  const banner = await tp.locator('.inv-test').innerText();
  await tp.click('[data-testid=rsvp-open]'); await tp.waitForSelector('.sheet form');
  await tp.fill('input[name=name]', 'בודק בדיקה'); await tp.fill('input[name=phone]', '0541234567');
  await tp.click('.sheet button[type=submit]'); await tp.waitForSelector('[data-testid=rsvp-success]'); await sleep(600);
  await tp.screenshot({ path: path.join(out, 'phone-test-mode.png') });
  console.log('test mode:', JSON.stringify({ banner: banner.includes('מצב בדיקה'), thanks: (await tp.locator('[data-testid=rsvp-success]').innerText()).includes('לא נשמרה'),
    guestsAdded: (await mock.sql(`select count(*)::int n from guests`))[0].n - before, visitsCounted: (await mock.sql(`select count(*)::int n from invitation_events`))[0].n - seen }));
  console.log('real visits recorded so far:', (await mock.sql(`select count(*)::int n from invitation_events where kind = 'visit'`))[0].n);
  const desk = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'he-IL' })).newPage();
  await desk.goto(`${APP}/e/kidar-brit`, { waitUntil: 'networkidle' }); await sleep(1200);
  await desk.screenshot({ path: path.join(out, 'desktop-top.png') });
  // every phone width the invitation has to hold, plus a desktop: no sideways scroll, nothing clipped, tap targets big enough
  for (const w of [320, 360, 390, 430, 1280]) {
    const pg = await (await browser.newContext({ viewport: { width: w, height: w > 500 ? 900 : 780 }, deviceScaleFactor: 1, isMobile: w < 500, hasTouch: w < 500, locale: 'he-IL' })).newPage();
    await pg.goto(`${APP}/e/kidar-brit`, { waitUntil: 'networkidle' }); await scrollAll(pg);
    const m = await pg.evaluate((W) => {
      const vw = W;
      const wide = [...document.querySelectorAll('.inv-col *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > vw + 1 || r.left < -1) && !e.closest('.inv-drift,canvas'); }).map((e) => e.className || e.tagName).slice(0, 4);
      const small = [...document.querySelectorAll('.inv a, .inv button')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 44 || r.width < 44) && !e.closest('.inv-sticky'); }).map((e) => `${e.textContent.trim().slice(0, 14)} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`);
      return { overflow: document.documentElement.scrollWidth - W, wide, small, dir: document.querySelector('.inv').dir, font: getComputedStyle(document.querySelector('.inv h1')).fontFamily.split(',')[0] };
    }, w);
    console.log(`width ${w}:`, JSON.stringify(m));
    await pg.screenshot({ path: path.join(out, `w${w}.png`), fullPage: true });
    await pg.locator('[data-testid=rsvp-open]').click(); await pg.waitForSelector('.sheet form'); await sleep(400);
    console.log(`  rsvp sheet overflow: ${await pg.evaluate(() => { const s = document.querySelector('.sheet'); return s.scrollWidth - s.clientWidth; })}`);
    await pg.screenshot({ path: path.join(out, `w${w}-rsvp.png`) });
    await pg.context().close();
  }
  // the new admin screens, on a phone and on a desktop
  await mock.sql(`insert into guests (event_id, family_name, phone, status, adults, group_name) select id, n, p, s::public.guest_status, a, g from events,
    (values ('משפחת כהן', '0501111111', 'attending', 2, 'משפחה'), ('משפחת לוי', '0502222222', 'pending', 0, 'חברים'), ('משפחת מזרחי', '0503333333', 'maybe', 0, 'חברים'), ('משפחת פרץ', null, 'pending', 0, 'עבודה')) v(n, p, s, a, g) where slug = 'kidar-brit'`);
  for (const [tag, ctxOpts] of [['phone', { ...devices['iPhone 13'], locale: 'he-IL' }], ['desktop', { viewport: { width: 1360, height: 900 }, locale: 'he-IL' }]]) {
    const ad = await (await browser.newContext(ctxOpts)).newPage();
    const aerr = []; ad.on('pageerror', (e) => aerr.push(e.message));
    await ad.goto(`${APP}/admin/login`); await ad.fill('input[type=password]', '1007'); await ad.click('button[aria-label="כניסה"]');
    await ad.waitForURL(/\/admin\/events\//); const base = ad.url().split('?')[0].replace(/\/$/, '');
    for (const pgName of ['overview', 'editor', 'guests', 'whatsapp', 'reminders', 'tables', 'export']) {
      await ad.goto(pgName === 'overview' ? base : `${base}/${pgName}`, { waitUntil: 'networkidle' }); await sleep(900);
      if (pgName === 'whatsapp') await ad.getByRole('button', { name: /סימון כל המוצגים/ }).click();
      if (pgName === 'editor') {
        await ad.getByRole('tab', { name: 'מועד' }).click({ timeout: 8000 }).catch(async (e) => console.log('editor tab not clickable:', aerr.join(' ; '), '|', String(e.message).split('\n').slice(0, 12).join(' / ')));
        await sleep(300);
      }
      await ad.screenshot({ path: path.join(out, `admin-${pgName}-${tag}.png`), fullPage: true });
      console.log(`admin ${pgName} ${tag}: overflow ${await ad.evaluate((W) => document.documentElement.scrollWidth - W, ctxOpts.viewport.width)}`);
    }
    console.log(`admin ${tag} errors:`, aerr.join(' ; ') || 'none');
    await ad.context().close();
  }
  console.log('errors:', errs.join(' ; ') || 'none');
} catch (e) { console.log('FAILED:', String(e.message ?? e).slice(0, 600)); } finally { await browser.close(); app.kill(); process.exit(0); }

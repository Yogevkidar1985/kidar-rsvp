// The floating "confirm" button: there from the first scroll, out of the way at the answer buttons, one tap to the form. On every screen size.
// usage: node tests/e2e/float.mjs <out dir>   (after `npm run build` with the mock's URL and key)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startMock, SERVICE, ANON } from './mock-supabase.mjs';

const { chromium, devices } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = process.argv[2] ?? '.';
const APP = 'http://127.0.0.1:3137', MOCK = 54399;
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mock = await startMock(MOCK, root); const sql = mock.sql;
await sql(`update events set published = true where slug = 'kidar-brit'`);
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE, RSVP_HASH_SECRET: 'test', INVITATION_CACHE_SECONDS: '0', GREEN_API_INSTANCE_ID: '', GREEN_API_TOKEN: '' };
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3137', '-H', '127.0.0.1'], { cwd: root, env, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { await fetch(APP + '/admin/login'); break; } catch { await sleep(500); } }
const browser = await chromium.launch();
const SCREENS = [
  ['iPhone SE', devices['iPhone SE']], ['iPhone 13', devices['iPhone 13']], ['iPhone 14 Pro Max', devices['iPhone 14 Pro Max']], ['iPhone 13 landscape', devices['iPhone 13 landscape']],
  ['Pixel 7', devices['Pixel 7']], ['Galaxy S9+', devices['Galaxy S9+']], ['Galaxy S9+ landscape', devices['Galaxy S9+ landscape']], ['iPad Mini', devices['iPad Mini']],
  ['small Android 320x568', { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }], ['desktop', { viewport: { width: 1280, height: 800 } }],
];
try {
  for (const [name, opt] of SCREENS) {
    const ctx = await browser.newContext({ ...opt, locale: 'he-IL' }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(APP + '/kidar-brit', { waitUntil: 'networkidle' }); await sleep(1000);
    const bar = () => p.evaluate(() => { const w = document.querySelector('.inv-sticky'), b = w.querySelector('button'), r = b.getBoundingClientRect(); const mid = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { on: w.classList.contains('show'), inView: r.top >= 0 && r.bottom <= innerHeight + 1 && r.left >= 0 && r.right <= innerWidth + 1, h: Math.round(r.height), hit: b.contains(mid), text: b.innerText.trim() }; });
    const to = async (y) => { await p.evaluate((v) => scrollTo(0, v), y); await sleep(700); };
    const rsvpTop = async () => p.evaluate(() => Math.round(document.getElementById('rsvp').getBoundingClientRect().top + scrollY));
    const a = await bar();
    await to(140); const b = await bar();
    await to((await rsvpTop()) - 40); const c = await bar();
    const picks = await p.evaluate(() => [...document.querySelectorAll('button.inv-pick')].every((x) => { const r = x.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.bottom <= innerHeight && x.contains(e); }));
    await p.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await sleep(700); const d = await bar();
    // at the very end either the button is there, or the answer section itself is on screen (it is the last part of the page on tall screens)
    const endSeesAnswers = await p.evaluate(() => { const r = document.getElementById('rsvp').getBoundingClientRect(); return r.top < innerHeight - 96 && r.bottom > 96; });
    const lastClear = await p.evaluate(() => { const bars = document.querySelector('.inv-sticky button').getBoundingClientRect(); const els = [...document.querySelectorAll('.inv-body *')].filter((e) => e.children.length === 0 && e.getClientRects().length && e.textContent.trim()); const last = els[els.length - 1].getBoundingClientRect(); return last.bottom <= bars.top + 1; });
    const ok = !a.on && b.on && b.inView && b.hit && b.h >= 48 && !c.on && ((d.on && d.inView && d.hit) || (endSeesAnswers && !d.on)) && lastClear;
    check(`${name}: hidden at the top, there after the first scroll, steps aside at the answers, and at the end of the page one of the two is on screen`, ok, JSON.stringify({ top: a.on, scrolled: [b.on, b.inView, b.hit, b.h], atAnswers: c.on, below: [d.on, d.hit], lastClear }));
    check(`${name}: at the answer section its own buttons are fully visible and nothing covers them`, picks || /landscape/.test(name), String(picks));
    await to(300); await p.locator('[data-testid=rsvp-float]').click(); await sleep(700);
    const sheet = await p.locator('.sheet form').count(); const after = await bar();
    check(`${name}: one tap opens the answer form, and the button gets out of its way`, sheet === 1 && !after.on && !errs.length, `${sheet} ${after.on} ${errs.join('|')}`);
    if (name === 'iPhone 13') { await p.keyboard.press('Escape'); await sleep(400); await to(300); await p.screenshot({ path: path.join(out, 'float.png') }); }
    await ctx.close();
  }
  { // after an answer the button offers to change it
    const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'he-IL' }); const p = await ctx.newPage();
    await p.goto(APP + '/kidar-brit', { waitUntil: 'networkidle' }); await sleep(600); await p.evaluate(() => scrollTo(0, 300)); await sleep(600);
    await p.locator('[data-testid=rsvp-float]').click(); await p.waitForSelector('.sheet form');
    await p.locator('[data-testid=rsvp-status] button', { hasText: 'מגיעים' }).first().click(); await p.fill('input[name=name]', 'משפחת צף'); await p.fill('input[name=phone]', '0508881122'); await p.click('[data-testid=rsvp-send]'); await p.waitForSelector('[data-testid=rsvp-success]', { timeout: 8000 });
    const [g] = await sql(`select status from guests where family_name = 'משפחת צף'`);
    await p.reload({ waitUntil: 'networkidle' }); await sleep(600); await p.evaluate(() => scrollTo(0, 300)); await sleep(700);
    check('an answer given through the floating button is saved, and the button then offers to change it', g?.status === 'attending' && (await p.locator('[data-testid=rsvp-float]').innerText()).includes('עדכון'));
    await ctx.close();
  }
} catch (e) { check('the suite ran to the end', false, String(e).slice(0, 400)); }
finally { await browser.close(); app.kill(); await new Promise((r) => mock.server.close(r)); }
const bad = results.filter((r) => !r).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);

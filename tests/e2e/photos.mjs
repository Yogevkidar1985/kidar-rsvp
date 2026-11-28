// The main photo: every earlier one can be taken back, a gallery photo can take its place, and undo returns the one before.
// usage: node tests/e2e/photos.mjs <out dir> <dir with a.jpg b.jpg c.jpg d.jpg>   (after `npm run build` with the mock's URL and key)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startMock, SERVICE, ANON } from './mock-supabase.mjs';

const { chromium, devices } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [out = '.', pics] = process.argv.slice(2);
const APP = 'http://127.0.0.1:3135', MOCK = 54399;
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mock = await startMock(MOCK, root); const sql = mock.sql;
await sql(`update events set published = true, hero_url = null where slug = 'kidar-brit'`);
const [{ id }] = await sql(`select id from events where slug = 'kidar-brit'`);
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE, RSVP_HASH_SECRET: 'test', INVITATION_CACHE_SECONDS: '0', GREEN_API_INSTANCE_ID: '', GREEN_API_TOKEN: '' };
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3135', '-H', '127.0.0.1'], { cwd: root, env, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { await fetch(APP + '/admin/login'); break; } catch { await sleep(500); } }
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'he-IL' }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(APP + '/admin/login'); await p.fill('input', '1007'); await p.click('button[aria-label="כניסה"]'); await p.waitForURL(/admin\/events/);
  await p.goto(`${APP}/admin/events/${id}/editor`, { waitUntil: 'networkidle' }); await sleep(800);
  await p.locator('.tabs > button', { hasText: 'תמונות' }).first().click(); await sleep(400);
  const card = p.locator('[data-testid=hero-card]');
  const hero = async () => (await sql(`select hero_url from events where id = $1`, [id]))[0].hero_url;
  const shown = () => p.evaluate(() => document.querySelector('[data-testid=preview-frame] .inv-hero img')?.getAttribute('src') ?? '');
  check('with no photo of its own the card says the default one is shown', (await card.innerText()).includes('ברירת המחדל') && (await p.locator('[data-testid=hero-past]').count()) === 0);
  const up = async (f) => { await card.locator('input[type=file]').setInputFiles(path.join(pics, f)); await sleep(2500); };
  await up('a.jpg'); const A = await hero();
  await up('b.jpg'); const B = await hero();
  check('a second upload replaces the main photo', !!A && !!B && A !== B);
  check('the first one is kept under "earlier main photos"', (await p.locator('[data-testid=hero-past] button').count()) === 1);
  await p.locator('[data-testid=hero-past] button').first().click(); await sleep(700);
  check('a tap on it puts it back in the preview', decodeURIComponent(await shown()).includes(A.split('/').pop()), (await shown()).slice(-60));
  check('and the one just replaced takes its place in the strip', (await p.locator('[data-testid=hero-past] button').count()) === 1 && (await hero()) === B);
  await p.locator('button[aria-label="ביטול הפעולה האחרונה"]').click(); await sleep(600);
  check('undo returns the photo that was there', decodeURIComponent(await shown()).includes(B.split('/').pop()));
  await p.locator('[data-testid=hero-past] button').first().click(); await sleep(500);
  await p.locator('button:visible', { hasText: /^שמירת השינויים|^שמירה$/ }).first().click(); await sleep(2500);
  check('after save the earlier photo is the event\'s main photo again', (await hero()) === A);
  // a photo from the gallery
  await p.locator('label.ph-drop', { hasText: 'הוספת תמונות לגלריה' }).locator('input[type=file]').setInputFiles([path.join(pics, 'c.jpg'), path.join(pics, 'd.jpg')]); await sleep(4500);
  const n = await p.locator('[data-testid=hero-own] button').count();
  check('gallery photos are offered for the main place', n === 2, `${n}`);
  await p.locator('[data-testid=hero-own] button').first().click(); await sleep(700);
  const [g] = await sql(`select url from media_assets where event_id = $1 order by sort limit 1`, [id]);
  check('a tap on one shows it as the main photo', decodeURIComponent(await shown()).includes(g.url.split('/').pop()));
  await p.locator('[data-testid=hero-default]').evaluate((b) => { b.scrollIntoView({ block: 'center' }); b.click(); }); await sleep(700); // the save bar and the preview strip move over it while the page settles
  const dflt = await shown();
  await p.locator('button[aria-label="ביטול הפעולה האחרונה"]').click(); await sleep(600);
  const back = decodeURIComponent(await shown());
  check('"back to the default photo" works and can be undone', !dflt.includes('storage') && back.includes(g.url.split('/').pop()), `${dflt.slice(-40)} → ${back.slice(-50)}`);
  check('the photos tab fits the phone, no errors', (await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)) && !errs.length, errs.join('|'));
  await sleep(4500); await p.locator('.ed-dock-toggle').evaluate((b) => b.click()); await card.evaluate((c) => c.scrollIntoView({ block: 'start' })); await p.evaluate(() => scrollBy(0, -90)); await sleep(600); await p.screenshot({ path: path.join(out, 'photos.png') });
  await ctx.close();
} catch (e) { check('the suite ran to the end', false, String(e).slice(0, 400)); }
finally { await browser.close(); app.kill(); await new Promise((r) => mock.server.close(r)); }
const bad = results.filter((r) => !r).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);

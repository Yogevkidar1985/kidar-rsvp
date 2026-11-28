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
  // many photos: the strips scroll inside themselves, the page never moves sideways
  for (const kind of ['הוספת תמונות לגלריה', 'הוספת תמונות של המקום']) { await p.locator('label.ph-drop', { hasText: kind }).locator('input[type=file]').setInputFiles(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'].map((f) => path.join(pics, f))); await sleep(7000); }
  for (const f of ['c.jpg', 'd.jpg', 'a.jpg']) await up(f);
  const wide = await p.evaluate(() => ({ page: document.documentElement.scrollWidth, view: innerWidth, own: document.querySelectorAll('[data-testid=hero-own] button').length, past: document.querySelectorAll('[data-testid=hero-past] button').length, strip: (() => { const e = document.querySelector('[data-testid=hero-own]'); return [e.scrollWidth, e.clientWidth]; })() }));
  check('with many photos the page is still exactly as wide as the phone', wide.page <= 391 && wide.view <= 391 && wide.own >= 9 && wide.strip[0] > wide.strip[1] && wide.strip[1] <= wide.view, JSON.stringify(wide));
  // ---- the gallery grid on a phone: swap by two taps, drag by holding, a quick swipe only scrolls ----
  {
    const grid = '[data-testid=media-gallery]';
    const order = () => p.$$eval(`${grid} li`, (ls) => ls.map((l) => l.dataset.mediaId));
    const saved = async () => (await sql(`select id from media_assets where event_id = $1 and kind = 'gallery' order by sort`, [id])).map((r) => r.id);
    const mid = async (i) => { const b = await p.locator(`${grid} li`).nth(i).locator('.media-pic').boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
    if ((await p.locator('.ed-dock-toggle').innerText()).includes('הסתרה')) await p.locator('.ed-dock-toggle').evaluate((b) => b.click()); // the live strip folds away, as a person does to see the photos
    await sleep(500); await p.locator(`${grid} li`).nth(1).evaluate((e) => e.scrollIntoView({ block: 'center' })); await sleep(700);
    const under = await p.evaluate((g) => [0, 1, 2, 3].map((i) => { const pic = document.querySelectorAll(`${g} li`)[i].querySelector('.media-pic'), r = pic.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return pic.contains(e) ? 'ok' : (e?.className || e?.tagName); }), grid);
    if (under.some((u) => u !== 'ok')) console.log('   covered:', under.join(' | '));
    const o0 = await order();
    const clear = await p.evaluate((g) => [...document.querySelectorAll(`${g} li`)].every((li) => { const pic = li.querySelector('.media-pic').getBoundingClientRect(), bar = li.querySelector('.media-bar').getBoundingClientRect(); return bar.top >= pic.bottom - 1 && [...li.querySelectorAll('.media-bar button')].every((b) => b.getBoundingClientRect().height >= 40 && b.getBoundingClientRect().width >= 40); }), grid);
    check('the picture is left clear: its move controls sit under it, each big enough for a finger', clear && o0.length >= 4);
    let [x, y] = await mid(0); await p.touchscreen.tap(x, y); await sleep(300);
    check('a tap marks a photo and says what to do next', (await p.locator(`${grid} li.is-sel`).count()) === 1 && (await p.locator('.media-hint').first().innerText()).includes('נבחרה'));
    [x, y] = await mid(2); await p.touchscreen.tap(x, y); await sleep(1200);
    const o1 = await order();
    check('a tap on another photo swaps the two, and the order is saved', o1[0] === o0[2] && o1[2] === o0[0] && o1[1] === o0[1] && (await saved()).join() === o1.join(), `${o0.map((v) => v.slice(0, 4))} -> ${o1.map((v) => v.slice(0, 4))}`);
    const cdp = await ctx.newCDPSession(p); const pt = (px, py) => [{ x: Math.round(px), y: Math.round(py) }];
    const [ax, ay] = await mid(1), [bx, by] = await mid(3);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(ax, ay) }); await sleep(450); // the hold
    for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(ax + (bx - ax) * i / 10, ay + (by - ay) * i / 10) }); await sleep(20); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(1200);
    const o2 = await order();
    check('holding a photo and dragging it moves it there, and the order is saved', o2[3] === o1[1] && o2.join() !== o1.join() && (await saved()).join() === o2.join(), `${o1.map((v) => v.slice(0, 4))} -> ${o2.map((v) => v.slice(0, 4))}`);
    const [cx, cy] = await mid(0);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(cx, cy) });
    for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(cx, cy - i * 12) }); await sleep(15); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(700);
    check('a quick swipe over a photo moves nothing and marks nothing', (await order()).join() === o2.join() && (await p.locator(`${grid} li.is-sel`).count()) === 0);
    await p.locator(`${grid} li`).first().evaluate((e) => e.scrollIntoView({ block: 'center' })); await sleep(500);
    await p.locator(`${grid} li`).first().screenshot({ path: path.join(out, 'media-tile.png') }).catch(() => {});
    await p.locator(grid).screenshot({ path: path.join(out, 'media-grid.png') }).catch(() => {});
  }
  check('the photos tab fits the phone, no errors', (await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)) && !errs.length, errs.join('|'));
  await sleep(4500); await p.locator('.ed-dock-toggle').evaluate((b) => b.click()); await card.evaluate((c) => c.scrollIntoView({ block: 'start' })); await p.evaluate(() => scrollBy(0, -90)); await sleep(600); await p.screenshot({ path: path.join(out, 'photos.png') });
  await ctx.close();
} catch (e) { check('the suite ran to the end', false, String(e).slice(0, 400)); }
finally { await browser.close(); app.kill(); await new Promise((r) => mock.server.close(r)); }
const bad = results.filter((r) => !r).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);

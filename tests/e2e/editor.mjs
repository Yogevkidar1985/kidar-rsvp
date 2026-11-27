// Browser pass over the editor's animation tab and the WhatsApp connection screen, on a phone and on a wide screen.
// usage: node tests/e2e/editor.mjs <out dir>   (after `npm run build` with the mock's URL and key)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { startMock, SERVICE, ANON } from './mock-supabase.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = process.argv[2] ?? '.';
const APP = 'http://127.0.0.1:3115', MOCK = 54399;
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mock = await startMock(MOCK, root);
await mock.sql(`update events set published = true, venue_name = 'אולם הדוגמה', address = 'הרצל 1, כפר סבא' where slug = 'kidar-brit'`);
const [{ id }] = await mock.sql(`select id from events where slug = 'kidar-brit'`);
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE, RSVP_HASH_SECRET: 'test', GREEN_API_INSTANCE_ID: '', GREEN_API_TOKEN: '' };
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3115', '-H', '127.0.0.1'], { cwd: root, env, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { await fetch(APP + '/admin/login'); break; } catch { await sleep(500); } }
const browser = await chromium.launch();
try {
  for (const [tag, vp] of [['phone', { width: 390, height: 844 }], ['wide', { width: 1280, height: 900 }]]) {
    const ctx = await browser.newContext({ viewport: vp, locale: 'he-IL', deviceScaleFactor: 1, permissions: ['clipboard-read', 'clipboard-write'] });
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(APP + '/admin/login'); await p.fill('input', '1007'); await p.click('button[aria-label="כניסה"]'); await p.waitForURL(/admin\/events/);
    await p.goto(`${APP}/admin/events/${id}/editor`, { waitUntil: 'networkidle' });
    const head = await p.evaluate(() => { const b = [...document.querySelectorAll('.page-title')][0].parentElement.parentElement.querySelectorAll('button'); const tops = new Set([...b].filter((x) => x.offsetParent).map((x) => Math.round(x.getBoundingClientRect().top / 8))); return { rows: tops.size, wider: document.documentElement.scrollWidth - innerWidth }; });
    check(`${tag}: the editor's header buttons sit on one row`, head.rows === 1 && head.wider <= 0, JSON.stringify(head));
    await p.getByRole('tab', { name: 'אנימציות' }).click(); await sleep(300);
    const tiles = await p.locator('[data-testid=kinds-fall] .kind-tile').count();
    const painted = await p.$$eval('[data-testid=kinds-fall] canvas', (cs) => cs.filter((c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) return true; return false; }).length);
    check(`${tag}: eleven kinds, each drawn`, tiles === 11 && painted === 11, `${tiles} tiles, ${painted} painted`);
    const small = await p.$$eval('[data-testid=fall-controls] button, [data-testid=fall-controls] input[type=color]', (els) => els.filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.height < 22 || r.width < 22); }).length);
    check(`${tag}: nothing in the confetti controls is too small to tap`, small === 0, String(small));
    await p.locator('[data-testid=kinds-fall] .kind-tile', { hasText: 'סרטים' }).click();
    for (const [label, v] of [['מהירות', '2'], ['גודל', '1.8'], ['עובי', '2.2']]) await p.locator('[data-testid=fall-controls] label', { hasText: label }).first().locator('input').fill(v);
    const n0 = await p.locator('[data-testid=fall-colors] input').count();
    await p.locator('[data-testid=fall-controls] button', { hasText: '+ צבע' }).click();
    await p.locator('[data-testid=fall-controls] button', { hasText: 'צבעוני' }).click();
    const n1 = await p.locator('[data-testid=fall-colors] input').count();
    await p.locator('[data-testid=fall-colors] button[aria-label="הסרת צבע 1"]').click();
    const n2 = await p.locator('[data-testid=fall-colors] input').count();
    check(`${tag}: colours can be added, replaced by a set, and removed`, n0 === 4 && n1 === 5 && n2 === 4, `${n0} ${n1} ${n2}`);
    await p.screenshot({ path: path.join(out, `editor-anim-${tag}.png`), fullPage: tag === 'phone' });
    if (tag === 'phone') { await p.getByRole('button', { name: /תצוגה/ }).first().click(); await sleep(1500); }
    const falling = await p.evaluate(() => { const c = document.querySelector('[data-testid=preview-frame] canvas'); if (!c || !c.width) return -1; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 20) n++; return n; });
    check(`${tag}: the preview shows the pieces falling`, falling > 200, String(falling));
    await p.screenshot({ path: path.join(out, `editor-preview-${tag}.png`) });
    if (tag === 'phone') await p.getByRole('button', { name: /עריכה/ }).first().click();
    await (tag === 'phone' ? p.locator('.fixed button', { hasText: 'שמירה' }) : p.getByRole('button', { name: 'שמירת השינויים' })).click(); await sleep(900);
    const [{ f }] = await mock.sql(`select design->'fall' f from events where id = $1`, [id]);
    check(`${tag}: kind, speed, size, thickness and colours are saved`, f.kind === 'ribbons' && f.speed === 2 && f.size === 1.8 && f.thick === 2.2 && f.colors.length === 4, JSON.stringify(f));
    const inv = await ctx.newPage(); await inv.goto(`${APP}/kidar-brit`, { waitUntil: 'networkidle' }); await sleep(1500);
    await inv.screenshot({ path: path.join(out, `invite-ribbons-${tag}.png`) }); await inv.close();

    // the WhatsApp connection screen
    await p.goto(`${APP}/admin/events/${id}/connections`, { waitUntil: 'networkidle' });
    const c = p.locator('[data-testid=green-connect]');
    check(`${tag}: the connection form is offered when nothing is connected`, await c.locator('input').count() === 3 && (await c.innerText()).includes('לא מחובר'));
    await c.locator('input').nth(0).fill('1101000001'); await c.locator('input').nth(1).fill('abcdef0123456789abcdef0123456789');
    await c.getByRole('button', { name: 'בדיקה וחיבור' }).click(); await c.locator('[role=status]').waitFor({ timeout: 15000 });
    check(`${tag}: a failed check says so and stores nothing`, /Green API/.test(await c.locator('[role=status]').innerText()) && (await mock.sql(`select count(*)::int n from event_secrets`))[0].n === 0, await c.locator('[role=status]').innerText());
    check(`${tag}: the connections screen fits the width`, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await p.screenshot({ path: path.join(out, `connections-${tag}.png`), fullPage: true });
    check(`${tag}: no script errors`, errs.length === 0, errs.join(' ; '));
    await ctx.close();
  }

  // photos: uploaded, then dragged into a new order with a mouse and with a finger
  {
    const imgs = process.argv[3];
    const names = async (p) => (await mock.sql(`select path from media_assets where kind = 'venue' order by sort, created_at`)).map((r) => r.path.slice(-12, -4));
    for (const [tag, opts] of [['mouse', { viewport: { width: 1280, height: 900 } }], ['finger', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]]) {
      const ctx = await browser.newContext({ ...opts, locale: 'he-IL' });
      const p = await ctx.newPage();
      await p.goto(APP + '/admin/login'); await p.fill('input', '1007'); await p.click('button[aria-label="כניסה"]'); await p.waitForURL(/admin\/events/);
      await p.goto(`${APP}/admin/events/${id}/editor`, { waitUntil: 'networkidle' });
      await p.getByRole('tab', { name: 'תמונות' }).click();
      if (tag === 'mouse') {
        await p.locator('label', { hasText: 'הוספת תמונות של המקום' }).locator('input').setInputFiles(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'].map((f) => path.join(imgs, f)));
        await p.locator('[data-testid=media-venue] li').nth(3).waitFor({ timeout: 30000 }); await sleep(500);
      }
      const tiles = p.locator('[data-testid=media-venue] li');
      const before = await names(p);
      const box = async (i) => tiles.nth(i).boundingBox();
      if (tag === 'mouse') {
        const a = await box(3), b = await box(0);
        await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await p.mouse.down();
        await p.mouse.move(b.x + b.width / 2 + 20, b.y + b.height / 2, { steps: 12 }); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 }); await p.mouse.up();
      } else {
        await tiles.first().scrollIntoViewIfNeeded();
        const grip = await tiles.nth(0).locator('.media-grip').boundingBox(), b = await box(2);
        const cdp = await ctx.newCDPSession(p);
        const pt = (x, y) => [{ x: Math.round(x), y: Math.round(y) }];
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(grip.x + 20, grip.y + 20) });
        for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(grip.x + 20 + (b.x + b.width / 2 - grip.x - 20) * i / 10, grip.y + 20 + (b.y + b.height / 2 - grip.y - 20) * i / 10) });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        check('finger: every control on a photo is big enough to tap', await p.$$eval('[data-testid=media-venue] button', (bs) => bs.every((b) => b.getBoundingClientRect().height >= 36 && b.getBoundingClientRect().width >= 30)));
      }
      await sleep(900);
      const after = await names(p);
      const want = tag === 'mouse' ? [before[3], before[0], before[1], before[2]] : [before[1], before[2], before[0], before[3]];
      check(`${tag}: a dragged photo lands where it was dropped, and the order is saved`, after.join() === want.join(), `${before} -> ${after}`);
      if (tag === 'finger') {
        await p.getByRole('button', { name: 'הזזת תמונה 4 מקום אחד קדימה' }).click(); await sleep(700);
        const stepped = await names(p);
        check('finger: the arrow buttons move a photo one place', stepped.join() === [after[0], after[1], after[3], after[2]].join(), `${after} -> ${stepped}`);
        await p.screenshot({ path: path.join(out, 'media-grid-phone.png') });
        const inv = await ctx.newPage(); await inv.goto(`${APP}/kidar-brit`, { waitUntil: 'networkidle' });
        const shown = await inv.$$eval('section.inv-band [data-testid=stack-gallery] img', (i) => i.map((x) => x.src.slice(-12, -4)));
        check('finger: the invitation shows the photos in the new order', shown.join() === stepped.slice(0, 3).join(), `${shown}`);
      }
      await ctx.close();
    }
  }

  // links: a family's own code, the WhatsApp card texts, and the invitation's address
  {
    const [g] = await mock.sql(`insert into guests (event_id, family_name, phone, status) values ($1, 'משפחת כהן', '0501112233', 'pending') returning id, link_code`, [id]);
    const post = (token) => fetch(`${APP}/api/rsvp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: 'kidar-brit', token, name: 'משפחת כהן', phone: '0501112233', status: 'attending', adults: 2, children: 1, babies: 0 }) });
    let r = await post(g.link_code);
    check('links: an answer through the short personal link is saved on the family', r.status === 200 && (await mock.sql(`select status, adults from guests where id = $1`, [g.id]))[0].status === 'attending', String(r.status));
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'he-IL', permissions: ['clipboard-read', 'clipboard-write'] });
    const p = await ctx.newPage(); p.on('dialog', (d) => d.accept());
    await p.goto(APP + '/admin/login'); await p.fill('input', '1007'); await p.click('button[aria-label="כניסה"]'); await p.waitForURL(/admin\/events/);
    await p.goto(`${APP}/admin/events/${id}/links`, { waitUntil: 'networkidle' });
    const row = p.locator('[data-testid=link-row]', { hasText: 'משפחת כהן' });
    await row.getByRole('button', { name: 'העתקה' }).click(); await sleep(300);
    check('links: the personal link is copied', (await p.evaluate(() => navigator.clipboard.readText())) === `${APP}/kidar-brit/${g.link_code}`);
    await row.getByRole('button', { name: 'עריכה' }).click(); await row.locator('input').fill('cohen'); await row.getByRole('button', { name: 'שמירה' }).click(); await sleep(900);
    check('links: a chosen word replaces the code', (await mock.sql(`select link_code from guests where id = $1`, [g.id]))[0].link_code === 'cohen' && (await row.innerText()).includes('kidar-brit/cohen'));
    await mock.sql(`update guests set status = 'pending', adults = 0, children = 0 where id = $1`, [g.id]);
    r = await post('cohen');
    check('links: the chosen word opens that family and takes its answer', r.status === 200 && (await mock.sql(`select status from guests where id = $1`, [g.id]))[0].status === 'attending' && (await mock.sql(`select count(*)::int n from guests where event_id = $1 and phone_norm is not null and family_name = 'משפחת כהן'`, [id]))[0].n === 1, String(r.status));
    r = await post(g.link_code);
    check('links: the replaced code no longer stands for the family', (await fetch(`${APP}/kidar-brit/${g.link_code}`)).status === 200);
    const prev = p.locator('[data-testid=link-preview]');
    await prev.locator('input').fill('הברית של קידר הקטן'); await prev.locator('textarea').fill('יום רביעי, 2.12, 15:00 · Tesoro'); await prev.getByRole('button', { name: 'שמירה' }).click(); await sleep(900);
    const html = await (await fetch(`${APP}/kidar-brit`)).text();
    check('links: the WhatsApp card carries the edited title and description', html.includes('property="og:title" content="הברית של קידר הקטן"') && html.includes('property="og:description" content="יום רביעי, 2.12, 15:00 · Tesoro"'));
    check('links: the screen fits a phone', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await p.screenshot({ path: path.join(out, 'links-phone.png'), fullPage: true });
    const main = p.locator('[data-testid=link-main]');
    await main.locator('input').fill('Kidar Party!'); 
    check('links: the address field keeps only valid characters', (await main.locator('input').inputValue()) === 'kidarparty');
    await main.locator('input').fill('kidar-party'); await main.getByRole('button', { name: 'שמירת הכתובת' }).click(); await sleep(1200);
    check('links: the new address opens the invitation and the old one does not', (await fetch(`${APP}/kidar-party/cohen`)).status === 200 && (await fetch(`${APP}/kidar-brit`)).status === 404);
    await mock.sql(`update events set slug = 'kidar-brit' where id = $1`, [id]);
    await ctx.close();
  }

  // the setup notice, shown while the database update has not been run
  await mock.sql(`alter table campaigns rename to campaigns_off`);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'he-IL', permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage();
  await p.goto(APP + '/admin/login'); await p.fill('input', '1007'); await p.click('button[aria-label="כניסה"]'); await p.waitForURL(/admin\/events/);
  await p.goto(`${APP}/admin/events/${id}/whatsapp`, { waitUntil: 'networkidle' });
  await p.locator('[data-testid=setup-notice]').waitFor();
  await p.getByRole('button', { name: 'העתקת קוד העדכון' }).click(); await sleep(700);
  const clip = await p.evaluate(() => navigator.clipboard.readText());
  check('the setup notice copies the whole update', clip.includes('create table if not exists public.messages') && clip.includes('link_code') && clip.includes('event_secrets') && clip.includes('kidar-rsvp-tick'), `${clip.length} chars`);
  check('and links to the SQL editor', (await p.locator('[data-testid=setup-notice] a').first().getAttribute('href')).includes('supabase.com/dashboard'));
  await p.screenshot({ path: path.join(out, 'setup-notice.png') });
  await ctx.close();
} catch (e) { check('the run completed', false, e?.stack ?? String(e)); }
finally { await browser.close(); app.kill(); await mock.close?.(); }
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);

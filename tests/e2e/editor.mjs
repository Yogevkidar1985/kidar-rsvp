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
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE, RSVP_HASH_SECRET: 'test', INVITATION_CACHE_SECONDS: '0', GREEN_API_INSTANCE_ID: '', GREEN_API_TOKEN: '' };
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
        await tiles.first().evaluate((e) => e.scrollIntoView({ block: 'center' })); await sleep(400);
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
        const shown = await inv.$$eval('section.inv-band [data-testid=stack-gallery] img', (i) => i.map((x) => (new URL(x.src).searchParams.get('url') ?? x.src).slice(-12, -4)));
        check('finger: the invitation shows the photos in the new order', shown.join() === stepped.slice(0, 3).join(), `${shown}`);
      }
      await ctx.close();
    }
  }

  // the clock, the countdown, the photo viewer and an answer without a phone number
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'he-IL' });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`${APP}/kidar-brit`, { waitUntil: 'networkidle' }); await sleep(500);
    const clock = await p.evaluate(() => { const d = document.querySelector('.inv-times > div'); const b = d.querySelector('b').getBoundingClientRect(), s = d.querySelector('svg').getBoundingClientRect(); return s.right <= b.left + 1; });
    check('clock: the icon sits to the left of the hour', clock);
    const cd = async () => p.evaluate(() => [...document.querySelectorAll('[data-testid=countdown] > div')].map((c) => ({ l: c.querySelector('span').textContent, n: c.querySelector('b').textContent, x: Math.round(c.getBoundingClientRect().left) })));
    const c1 = await cd(); await sleep(2100); const c2 = await cd();
    const labels = c1.map((c) => c.l).join();
    check('countdown: days on the left, then hours, minutes and seconds on the right', (labels === 'ימים,שעות,דקות,שניות' || labels === 'שעות,דקות,שניות') && c1.every((c, i) => !i || c.x > c1[i - 1].x), JSON.stringify(c1));
    check('countdown: the seconds tick', c1[c1.length - 1].n !== c2[c2.length - 1].n, `${c1[c1.length - 1].n} -> ${c2[c2.length - 1].n}`);
    check('countdown: fits the screen', await p.evaluate(() => { const r = document.querySelector('[data-testid=countdown]').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth; }));
    for (const w of [320, 360]) { await p.setViewportSize({ width: w, height: 700 }); await sleep(300); check(`countdown: fits at ${w}`, await p.evaluate(() => { const c = [...document.querySelectorAll('[data-testid=countdown] > div')]; return c.every((x) => x.getBoundingClientRect().left >= 0 && x.getBoundingClientRect().right <= innerWidth && x.querySelector('b').scrollWidth <= x.clientWidth) && document.documentElement.scrollWidth <= innerWidth; })); }
    await p.setViewportSize({ width: 390, height: 844 });
    // small versions for the cards, the full one only in the viewer
    const g = p.locator('section.inv-band [data-testid=stack-gallery]');
    await g.evaluate((e) => e.scrollIntoView({ block: 'center' })); await sleep(900);
    const srcs = await g.locator('img').evaluateAll((im) => im.map((i) => i.currentSrc));
    check('gallery: cards load a resized picture, not the original', srcs.length === 3 && srcs.every((s) => s.includes('/_next/image?') && /w=(384|640)/.test(s)), srcs[0]);
    check('gallery: the resized pictures arrive', await g.locator('img').evaluateAll((im) => im.every((i) => i.complete && i.naturalWidth > 0 && i.naturalWidth <= 640)));
    await g.locator('.sgal__card').nth(2).tap(); await sleep(900);
    const n = await g.locator('.sgal__card.is-grid').count();
    await g.locator('.sgal__card').nth(0).tap(); const lb = p.locator('[data-testid=lightbox]'); await lb.waitFor();
    const idx = async () => (await lb.locator('.inv-light-nav span').innerText()).replace(/\s/g, '');
    check('viewer: opens on the tapped photo', (await idx()) === `1/${n}`, await idx());
    await p.waitForFunction(() => /w=1080/.test(document.querySelector('.inv-light-img').src), null, { timeout: 15000 }).catch(() => {});
    check('viewer: the full-size picture replaces the small one', /w=1080/.test(await lb.locator('img').getAttribute('src')));
    await p.touchscreen.tap(195, 420); await sleep(350);
    check('viewer: a tap on the screen shows the next photo', (await idx()) === `2/${n}`, await idx());
    await p.touchscreen.tap(60, 300); await sleep(350);
    check('viewer: and another tap the one after', (await idx()) === `3/${n}`, await idx());
    const cdp = await ctx.newCDPSession(p);
    const swipe = async (x0, x1, y0 = 420, y1 = 420) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] }); for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / 6, y: y0 + (y1 - y0) * i / 6 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(450); };
    await swipe(90, 300); check('viewer: a swipe to the right goes forward, once', (await idx()) === `4/${n}`, await idx());
    await swipe(300, 90); check('viewer: a swipe to the left goes back, once', (await idx()) === `3/${n}`, await idx());
    await swipe(300, 90); await swipe(300, 90); await swipe(300, 90); check('viewer: going back past the first photo wraps to the last', (await idx()) === `${n}/${n}`, await idx());
    await swipe(90, 300); check('viewer: and forward past the last wraps to the first', (await idx()) === `1/${n}`, await idx());
    await swipe(195, 215, 400, 430); check('viewer: a small drag is not a swipe', ['1', '2'].includes((await idx())[0]));
    const at = await idx();
    await lb.getByRole('button', { name: 'התמונה הקודמת' }).tap(); await sleep(350);
    check('viewer: the arrow buttons move one photo and do not also count as a tap', (await idx()) !== at && Math.abs((parseInt(await idx()) - parseInt(at) + n) % n) === n - 1, `${at} -> ${await idx()}`);
    check('viewer: the photo fills the width and stays on screen', await lb.locator('img').evaluate((i) => { const r = i.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1 && r.height > 100 && r.bottom <= innerHeight; }));
    await swipe(195, 200, 250, 560); check('viewer: a swipe down closes it', await lb.count() === 0);
    await g.locator('.sgal__card').nth(1).tap(); await lb.waitFor(); await lb.locator('.inv-light-x').tap(); await sleep(300);
    check('viewer: the × closes it', await lb.count() === 0);
    check('viewer and countdown: no script errors', errs.length === 0, errs.join(' ; '));

    // an answer without a phone number
    const before = (await mock.sql(`select count(*)::int n from guests where event_id = $1`, [id]))[0].n;
    await p.locator('[data-testid=rsvp-open]').evaluate((e) => e.scrollIntoView({ block: 'center' })); await sleep(400); await p.locator('[data-testid=rsvp-open]').tap();
    await p.locator('.sheet input[name=name]').fill('משפחת בלי טלפון');
    const order = await p.evaluate(() => { const y = (q) => document.querySelector(q)?.getBoundingClientRect().top ?? -1; return [y('.sheet input[name=name]'), y('.sheet input[name=phone]'), y('[data-testid=rsvp-prefs]'), y('.sheet-add')]; });
    check('answer: name, phone, preferences, then the note', order.every((v, i) => v > 0 && (!i || v > order[i - 1])), JSON.stringify(order));
    check('answer: kashrut is the first preference', (await p.locator('[data-testid=rsvp-prefs] .sheet-chips button').first().innerText()) === 'כשרות');
    await p.locator('[data-testid=rsvp-prefs] .sheet-chips button', { hasText: 'כשרות' }).tap(); await p.locator('[data-testid=rsvp-prefs] .sheet-chips button', { hasText: 'כיסא תינוק' }).tap();
    await p.locator('.sheet input[name=preferences]').fill('ללא גלוטן');
    check('answer: the send button stays on screen', await p.locator('[data-testid=rsvp-send]').evaluate((b) => { const r = b.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }));
    await p.screenshot({ path: path.join(out, 'sheet-phone.png') });
    check('answer: the phone field says it is optional', (await p.locator('.sheet label', { hasText: 'טלפון נייד' }).innerText()).includes('לא חובה'));
    await p.locator('.sheet button[type=submit]').tap(); await p.locator('[data-testid=rsvp-success]').waitFor({ timeout: 10000 });
    let rows = await mock.sql(`select id, phone, status, adults, link_code, preferences from guests where event_id = $1 and family_name = 'משפחת בלי טלפון'`, [id]);
    check('answer: tapped and typed preferences are saved together, kashrut first', rows[0]?.preferences === 'כשרות, כיסא תינוק, ללא גלוטן', rows[0]?.preferences);
    check('answer: saved without a phone number', rows.length === 1 && rows[0].phone === null && rows[0].status === 'attending', JSON.stringify(rows));
    check('answer: the phone remembers the family\'s own code', (await p.evaluate(() => Object.entries(localStorage).find(([k]) => k.endsWith(':own'))?.[1])) === rows[0].link_code);
    await p.reload({ waitUntil: 'networkidle' }); await p.locator('[data-testid=rsvp-open]').evaluate((e) => e.scrollIntoView({ block: 'center' })); await sleep(400); await p.locator('[data-testid=rsvp-open]').tap();
    await p.locator('.sheet button', { hasText: 'לא מגיעים' }).first().tap().catch(() => {});
    await p.locator('.sheet input[name=name]').fill('משפחת בלי טלפון'); await p.locator('.sheet button[type=submit]').tap(); await p.locator('[data-testid=rsvp-success]').waitFor({ timeout: 10000 });
    rows = await mock.sql(`select id, status from guests where event_id = $1 and family_name = 'משפחת בלי טלפון'`, [id]);
    check('answer: changing it later updates the same family instead of adding another', rows.length === 1 && (await mock.sql(`select count(*)::int n from guests where event_id = $1`, [id]))[0].n === before + 1, JSON.stringify(rows));
    const bad = await fetch(`${APP}/api/rsvp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: 'kidar-brit', name: 'משפחת טעות', phone: '123', status: 'attending', adults: 1, children: 0, babies: 0 }) });
    check('answer: a number that was typed must still be a real one', bad.status === 400);
    await ctx.close();
  }

  // the editor's guide, and the guest's last moments on the invitation
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'he-IL' });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(APP + '/admin/login'); await p.fill('input', '1007'); await p.click('button[aria-label="כניסה"]'); await p.waitForURL(/admin\/events/);
    await p.goto(`${APP}/admin/events/${id}/editor`, { waitUntil: 'networkidle' });
    const steps = p.locator('[data-testid=ed-steps]');
    check('guide: six steps, the filled ones marked', await steps.locator('li').count() === 6 && await steps.locator('.is-ok').count() >= 3, await steps.innerText());
    await steps.getByRole('button', { name: /מקום וכתובת/ }).click(); await sleep(500);
    check('guide: a step opens its tab', await p.getByRole('tab', { name: 'מקום' }).getAttribute('aria-selected') === 'true' && p.url().includes('tab='));
    await p.getByRole('button', { name: /הבא: תמונות/ }).click(); await sleep(400);
    check('guide: "next" moves to the following tab', await p.getByRole('tab', { name: 'תמונות' }).getAttribute('aria-selected') === 'true');
    await p.goto(`${APP}/admin/events/${id}/editor?tab=${encodeURIComponent('מועד')}`, { waitUntil: 'networkidle' });
    check('guide: a link can name the tab to open', await p.getByRole('tab', { name: 'מועד' }).getAttribute('aria-selected') === 'true');
    await p.getByRole('tab', { name: 'תוכן' }).click();
    const closing = p.locator('label', { hasText: 'טקסט סיום' }).locator('textarea'); const was = await closing.inputValue();
    await closing.fill(was + ' '); await closing.fill(was + '!'); await p.keyboard.press('Control+s'); await sleep(1200);
    check('guide: Ctrl+S saves', (await mock.sql(`select closing_text c from events where id = $1`, [id]))[0].c === was + '!');
    await mock.sql(`update events set closing_text = $2 where id = $1`, [id, was]);
    check('guide: the editor fits a phone', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await p.screenshot({ path: path.join(out, 'editor-guide-phone.png') });

    const inv = await ctx.newPage(); inv.on('pageerror', (e) => errs.push(e.message));
    await inv.goto(`${APP}/kidar-brit?test=1`, { waitUntil: 'networkidle' });
    check('invitation: the credit line closes the page', (await inv.locator('[data-testid=credit]').innerText()).replace(/\s+/g, ' ').trim() === 'נוצר ב ❤️ על ידי יוגב קידר', await inv.locator('[data-testid=credit]').innerText());
    const clear = await inv.evaluate(() => { const c = document.querySelector('[data-testid=credit]'); window.scrollTo(0, document.documentElement.scrollHeight); const r = c.getBoundingClientRect(), s = document.querySelector('.inv-sticky')?.getBoundingClientRect(); const line = r.top + parseFloat(getComputedStyle(c).paddingTop) + 24; return !s || line <= s.top; });
    check('invitation: the floating button does not cover the credit line', clear);
    await inv.locator('[data-testid=rsvp-open]').scrollIntoViewIfNeeded(); await inv.locator('[data-testid=rsvp-open]').click();
    await inv.locator('.sheet input[name=name]').fill('משפחת בדיקה'); await inv.locator('.sheet input[name=phone]').fill('0509998877');
    await inv.locator('.sheet button[type=submit]').click();
    await inv.locator('[data-testid=rsvp-success]').waitFor({ timeout: 10000 }); await sleep(450); await inv.screenshot({ path: path.join(out, 'rsvp-party-early.png') }); await sleep(600);
    check('invitation: saving an answer throws the party behind the check mark', await inv.locator('[data-testid=rsvp-party] svg g').count() > 20 && await inv.locator('.sheet-check svg').count() === 1);
    await inv.screenshot({ path: path.join(out, 'rsvp-party.png') });
    check('guide and invitation: no script errors', errs.length === 0, errs.join(' ; '));
    await ctx.close();
    const wide = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'he-IL' })).newPage();
    await wide.goto(`${APP}/kidar-brit`, { waitUntil: 'networkidle' }); await wide.locator('.inv-pick').first().scrollIntoViewIfNeeded(); await sleep(600);
    await wide.locator('.inv-pick').nth(1).hover(); await sleep(600);
    const hov = await wide.locator('.inv-pick').nth(1).evaluate((b) => ({ shadow: getComputedStyle(b).boxShadow !== 'none', lift: new DOMMatrix(getComputedStyle(b).transform).m42 }));
    check('invitation: an answer button rises under the pointer', hov.shadow && hov.lift < -2, JSON.stringify(hov));
    await wide.context().close();
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

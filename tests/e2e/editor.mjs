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
await mock.sql(`update events set published = true where slug = 'kidar-brit'`);
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

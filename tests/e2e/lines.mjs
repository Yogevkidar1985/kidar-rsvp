// A size of its own for every line of text: the slider moves one line in the preview, the others stay, and guests get the same.
// usage: node tests/e2e/lines.mjs <out dir>   (after `npm run build` with the mock's URL and key)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startMock, SERVICE, ANON } from './mock-supabase.mjs';

const { chromium, devices } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = process.argv[2] ?? '.';
const APP = 'http://127.0.0.1:3129', MOCK = 54399;
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mock = await startMock(MOCK, root); const sql = mock.sql;
await sql(`update events set published = false, intro_text = 'שורה ראשונה\nשורה שנייה\nשורה שלישית' where slug = 'kidar-brit'`);
const [{ id }] = await sql(`select id from events where slug = 'kidar-brit'`);
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE, RSVP_HASH_SECRET: 'test', INVITATION_CACHE_SECONDS: '0', GREEN_API_INSTANCE_ID: '', GREEN_API_TOKEN: '' };
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3129', '-H', '127.0.0.1'], { cwd: root, env, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { await fetch(APP + '/admin/login'); break; } catch { await sleep(500); } }
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'he-IL' }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(APP + '/admin/login'); await p.fill('input', '1007'); await p.click('button[aria-label="כניסה"]'); await p.waitForURL(/admin\/events/);
  await p.goto(`${APP}/admin/events/${id}/editor`, { waitUntil: 'networkidle' }); await sleep(800);
  const px = (k) => p.evaluate((key) => { const el = document.querySelector(`[data-testid=preview-frame] [data-line="${key}"]`); return el ? parseFloat(getComputedStyle(el).fontSize) : 0; }, k);
  await p.locator('.tabs > button', { hasText: 'גדלים' }).first().click(); await sleep(400);
  const rows = await p.locator('[data-testid=line-sizes] .rng').count();
  check('every line of text has its own slider', rows >= 8 && (await p.locator('.rng[data-part="line:intro.0"]').count()) === 1 && (await p.locator('.rng[data-part="line:intro.2"]').count()) === 1, `${rows} lines`);
  const a0 = await px('intro.0'), b0 = await px('intro.1'), h0 = await px('headline.0');
  const plus = p.locator('.rng[data-part="line:intro.0"] button[aria-label$="יותר"]');
  for (let i = 0; i < 6; i++) await plus.click(); await sleep(500);
  const a1 = await px('intro.0'), b1 = await px('intro.1');
  check('the plus enlarges that line in the preview at once', Math.abs(a1 / a0 - 1.3) < 0.02, `${a0} → ${a1}`);
  check('the other lines keep their size', b1 === b0 && (await px('headline.0')) === h0, `${b0} → ${b1}`);
  check('the real size is written beside the value', /1\.3×\s*·\s*\d+px/.test(await p.locator('.rng[data-part="line:intro.0"] output').innerText()), await p.locator('.rng[data-part="line:intro.0"] output').innerText());
  const minus = p.locator('.rng[data-part="line:headline.0"] button[aria-label$="פחות"]');
  for (let i = 0; i < 4; i++) await minus.click(); await sleep(500);
  check('the minus shrinks a headline', Math.abs((await px('headline.0')) / h0 - 0.8) < 0.02);
  check('the editor still fits the phone', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await p.screenshot({ path: path.join(out, 'lines-editor.png') });
  // a tap on a line in the preview leads to its slider
  await p.locator('[data-testid=preview-frame] [data-line="sign"]').click({ force: true }); await sleep(700);
  check('a tap on a line in the preview marks its slider', (await p.locator('.rng[data-part="line:sign"][data-hit]').count()) === 1);
  await sleep(4500); // an unpublished invitation saves itself
  const [row] = await sql(`select design from events where id = $1`, [id]);
  check('the sizes are saved with the invitation', row.design?.lines?.['intro.0'] === 1.3 && row.design?.lines?.['headline.0'] === 0.8, JSON.stringify(row.design?.lines));
  await p.keyboard.press('Escape');
  const undo = p.locator('button[aria-label="ביטול הפעולה האחרונה"]'); await undo.click(); await sleep(400);
  check('undo takes a size change back', Math.abs((await px('headline.0')) / h0 - 0.8) > 0.02 || Math.abs((await px('intro.0')) / a0 - 1.3) > 0.02);
  await sql(`update events set published = true, design = jsonb_set(coalesce(design,'{}'::jsonb), '{lines}', '{"intro.0":1.3,"headline.0":0.8}'::jsonb) where id = $1`, [id]);
  const g = await ctx.newPage(); await g.goto(APP + '/kidar-brit', { waitUntil: 'networkidle' }); await sleep(800);
  const live = await g.evaluate(() => { const f = (k) => parseFloat(getComputedStyle(document.querySelector(`[data-line="${k}"]`)).fontSize); return [f('intro.0') / f('intro.1'), document.documentElement.scrollWidth <= innerWidth + 1, [...document.querySelectorAll('[data-line^="intro."]')].map((x) => x.textContent).join('|')]; });
  check('guests see the same sizes, each line on its own row', Math.abs(live[0] - 1.3) < 0.02 && live[1] && live[2] === 'שורה ראשונה|שורה שנייה|שורה שלישית', JSON.stringify(live));
  await g.screenshot({ path: path.join(out, 'lines-guest.png'), fullPage: true });
  check('no page errors', !errs.length, errs.join('|'));
  await ctx.close();
} catch (e) { check('the suite ran to the end', false, String(e).slice(0, 400)); }
finally { await browser.close(); app.kill(); await new Promise((r) => mock.server.close(r)); }
const bad = results.filter((r) => !r).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);

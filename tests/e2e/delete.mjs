// Deleting guests on a phone: one from its card, several at once from the selection, and taking either back.
// usage: node tests/e2e/delete.mjs <out dir>   (after `npm run build` with the mock's URL and key)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startMock, SERVICE, ANON } from './mock-supabase.mjs';

const { chromium, devices } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = process.argv[2] ?? '.';
const APP = 'http://127.0.0.1:3138', MOCK = 54399;
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mock = await startMock(MOCK, root); const sql = mock.sql;
await sql(`update events set published = true where slug = 'kidar-brit'`);
const [{ id }] = await sql(`select id from events where slug = 'kidar-brit'`);
for (const [i, n] of ['אלון', 'בן דוד', 'גולן', 'דיין', 'הראל'].entries()) await sql(`insert into guests (event_id, family_name, phone, status, adults) values ($1,$2,$3,'attending',2)`, [id, 'משפחת ' + n, '05044400' + (10 + i)]);
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE, RSVP_HASH_SECRET: 'test', INVITATION_CACHE_SECONDS: '0', GREEN_API_INSTANCE_ID: '', GREEN_API_TOKEN: '' };
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3138', '-H', '127.0.0.1'], { cwd: root, env, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { await fetch(APP + '/admin/login'); break; } catch { await sleep(500); } }
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'he-IL' }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(APP + '/admin/login'); await p.fill('input', '1007'); await p.click('button[aria-label="כניסה"]'); await p.waitForURL(/admin\/events/);
  await p.goto(`${APP}/admin/events/${id}/guests`, { waitUntil: 'networkidle' }); await sleep(700);
  const count = async () => (await sql(`select count(*)::int n from guests where event_id = $1`, [id]))[0].n;
  const cards = () => p.locator('[data-testid=guests-cards] > li').count(); // the chips inside a card are list items too
  const js = (loc) => loc.evaluate((b) => { b.scrollIntoView({ block: 'center' }); b.click(); });
  check('every card has its own delete button, big enough for a finger', (await p.locator('[data-testid=card-delete]').count()) === 5 && await p.$$eval('[data-testid=card-delete]', (bs) => bs.every((b) => b.getBoundingClientRect().height >= 40)));
  await js(p.locator('[data-testid=guests-cards] > li', { hasText: 'משפחת אלון' }).locator('[data-testid=card-delete]')); await sleep(400);
  check('it asks before deleting', (await p.locator('[role=dialog]').innerText()).includes('משפחת אלון') && (await count()) === 5);
  await p.locator('[role=dialog] button', { hasText: 'מחיקת המשפחה' }).click(); await sleep(1500);
  check('one family is deleted from its card', (await count()) === 4 && (await cards()) === 4 && (await p.locator('[data-testid=undo-delete]').innerText()).includes('נמחקה'), `${await count()} ${await cards()} ${await p.locator('[data-testid=undo-delete]').count()}`);
  await p.locator('[data-testid=undo-delete] button').click(); await sleep(1500);
  check('and comes back with "undo"', (await count()) === 5 && (await cards()) === 5, `${await count()} ${await cards()}`);
  // several at once
  for (const n of ['בן דוד', 'גולן', 'דיין']) await js(p.locator('[data-testid=guests-cards] > li', { hasText: 'משפחת ' + n }).locator('input[type=checkbox]'));
  await sleep(400);
  check('the selection bar offers to delete the chosen', (await p.locator('[data-testid=bulk-delete]').innerText()).includes('3'));
  await js(p.locator('[data-testid=bulk-delete]')); await sleep(400);
  const dlg = await p.locator('[role=dialog]').innerText();
  check('it names who will go and says a copy is kept', ['בן דוד', 'גולן', 'דיין'].every((n) => dlg.includes(n)) && dlg.includes('ארכיון') && (await count()) === 5);
  await p.screenshot({ path: path.join(out, 'delete-confirm.png') });
  await p.locator('[data-testid=bulk-delete-yes]').click(); await sleep(2500);
  const left = (await sql(`select family_name from guests where event_id = $1 order by family_name`, [id])).map((r) => r.family_name);
  check('the three chosen families are deleted, the others stay', left.join() === 'משפחת אלון,משפחת הראל' && (await cards()) === 2 && (await p.locator('[data-testid=bulk]').count()) === 0, `${left.join()} cards ${await cards()} bulk ${await p.locator('[data-testid=bulk]').count()}`);
  check('each deleted family is kept whole in the archive', (await sql(`select count(*)::int n from audit_logs where entity = 'guest' and action = 'archive'`))[0].n >= 4);
  await p.screenshot({ path: path.join(out, 'delete-undo.png') });
  await p.locator('[data-testid=undo-delete] button').click(); await sleep(3000);
  check('"undo" brings all three back', (await count()) === 5 && (await cards()) === 5, `${await count()} ${await cards()}`);
  check('the page fits the phone, no errors', (await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)) && !errs.length, errs.join('|'));
  await p.locator('[data-testid=guests-cards] > li').first().screenshot({ path: path.join(out, 'delete-card.png') });
  await ctx.close();
} catch (e) { check('the suite ran to the end', false, String(e).slice(0, 400)); }
finally { await browser.close(); app.kill(); await new Promise((r) => mock.server.close(r)); }
const bad = results.filter((r) => !r).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);

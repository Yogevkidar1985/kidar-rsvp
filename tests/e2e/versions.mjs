// Versions, undo and backup: the editor, the seating plan, deleted families and the backup file.
// usage: node tests/e2e/versions.mjs <out dir>   (after `npm run build` with the mock's URL and key)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startMock, SERVICE, ANON } from './mock-supabase.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = process.argv[2] ?? '.';
const APP = 'http://127.0.0.1:3123', MOCK = 54399;
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mock = await startMock(MOCK, root);
const sql = mock.sql;
await sql(`update events set published = true where slug = 'kidar-brit'`); // a published invitation never saves itself
const [{ id, slug }] = await sql(`select id, slug from events where slug = 'kidar-brit'`);
const add = async (name, adults, phone = null) => (await sql(`insert into guests (event_id, family_name, status, adults, phone, preferences) values ($1,$2,'attending',$3,$4,'צמחוני') returning id`, [id, name, adults, phone]))[0].id;
const cohen = await add('משפחת כהן', 4, '0501234567'), levy = await add('משפחת לוי', 3), dror = await add('משפחת דרור', 2);

const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE, RSVP_HASH_SECRET: 'test', INVITATION_CACHE_SECONDS: '0', GREEN_API_INSTANCE_ID: 'inst-secret-1', GREEN_API_TOKEN: 'tok-secret-2' };
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3123', '-H', '127.0.0.1'], { cwd: root, env, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { await fetch(APP + '/admin/login'); break; } catch { await sleep(500); } }
const browser = await chromium.launch();
const vers = async (kind) => sql(`select id, action, diff->>'label' label from audit_logs where entity='version' and action like $1 order by id`, [kind + '%']);
try {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'he-IL', acceptDownloads: true });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  await p.goto(APP + '/admin/login'); await p.fill('input', '1007'); await p.click('button[aria-label="כניסה"]'); await p.waitForURL(/admin\/events/);

  // ---------- editor ----------
  await p.goto(`${APP}/admin/events/${id}/editor`, { waitUntil: 'networkidle' }); await sleep(500);
  const [{ headline: h0 }] = await sql(`select headline from events where id=$1`, [id]);
  await p.evaluate((h) => { const el = [...document.querySelectorAll('input, textarea')].find((x) => x.value === h); el.setAttribute('data-h', '1'); }, h0);
  const target = p.locator('[data-h]');
  await target.fill('כותרת ראשונה'); await sleep(700);
  check('compare appears once something changed', await p.locator('[data-testid=ed-compare]').isVisible());
  await p.locator('[data-testid=ed-compare] button', { hasText: 'לפני' }).click(); await sleep(300);
  const pv = p.locator('[data-testid=ed-dock] .inv');
  check('"before" shows the saved invitation, not the draft', !(await pv.innerText()).includes('כותרת ראשונה'));
  await p.locator('[data-testid=ed-compare] button', { hasText: 'אחרי' }).click(); await sleep(300);
  check('"after" shows the draft again', (await pv.innerText()).includes('כותרת ראשונה'));
  await p.keyboard.press('Control+s'); await sleep(1500);
  let v = await vers('event');
  check('a save keeps the version it replaced and the one it wrote', v.length === 2 && v[0].label === 'לפני שינוי' && v[1].label === 'נשמרה', JSON.stringify(v.map((x) => x.label)));
  await target.fill('כותרת שנייה'); await sleep(700); await p.keyboard.press('Control+s'); await sleep(1500);
  v = await vers('event');
  check('an identical copy is not written twice', v.length === 3, String(v.length));

  // unsaved work survives a reload
  await target.fill('עבודה שלא נשמרה'); await sleep(1200);
  await p.reload({ waitUntil: 'networkidle' }); await sleep(600);
  await p.evaluate(() => { const el = [...document.querySelectorAll('input, textarea')].find((x) => x.value === 'כותרת שנייה'); el.setAttribute('data-h', '1'); });
  check('unsaved work is offered back after a reload', await p.locator('[data-testid=ed-recover]').isVisible());
  await p.locator('[data-testid=ed-recover] button', { hasText: 'החזרת השינויים' }).click(); await sleep(400);
  check('…and returns to the editor', (await p.locator('[data-testid=ed-dock] .inv').innerText()).includes('עבודה שלא נשמרה'));
  // Ctrl+Z outside a text box steps the editor back
  await p.locator('h1').first().click(); await p.keyboard.press('Control+z'); await sleep(400);
  check('Ctrl+Z takes the last change back', (await p.locator('[data-testid=ed-dock] .inv').innerText()).includes('כותרת שנייה'));
  await p.keyboard.press('Control+Shift+z'); await sleep(400);
  check('Ctrl+Shift+Z brings it again', (await p.locator('[data-testid=ed-dock] .inv').innerText()).includes('עבודה שלא נשמרה'));
  await p.keyboard.press('Control+z'); await sleep(300);

  // an old version, shown in the preview without saving
  await p.click('[data-testid=open-versions]'); await sleep(800);
  const rows = p.locator('[data-testid=versions-event] .ver-list li');
  check('the versions list shows every kept copy', (await rows.count()) === 3, String(await rows.count()));
  await rows.last().locator('button', { hasText: 'הצגה בתצוגה' }).click(); await sleep(700);
  check('an old version is shown in the preview', (await p.locator('.ed-preview .inv').innerText()).includes(h0) || !(await p.locator('.ed-preview .inv').innerText()).includes('כותרת שנייה'));
  check('…and nothing was saved by looking at it', (await sql(`select headline from events where id=$1`, [id]))[0].headline === 'כותרת שנייה');
  await p.screenshot({ path: path.join(out, 'versions-editor.png') });
  // a named restore point
  await p.goto(`${APP}/admin/events/${id}/backup`, { waitUntil: 'networkidle' }); await sleep(600);
  await p.fill('[data-testid=versions-event] input', 'הנוסח שאהבנו'); await p.locator('[data-testid=versions-event] form button').click(); await sleep(900);
  check('a named restore point is saved', (await vers('event')).some((x) => x.label === 'הנוסח שאהבנו' && x.action === 'event'));
  // restore the very first version from the backup page
  await p.locator('[data-testid=versions-event] .ver-list li').last().locator('button', { hasText: 'שחזור' }).click(); await sleep(1500);
  const after = (await sql(`select headline, slug, published from events where id=$1`, [id]))[0];
  check('a restore puts the old text back', after.headline === h0, after.headline);
  check('…and leaves the address of the invitation alone', after.slug === slug);
  check('…and what it replaced is still among the versions', (await sql(`select count(*)::int n from audit_logs where entity='version' and diff->'data'->>'headline' = 'כותרת שנייה'`))[0].n >= 1);

  // a draft nobody sees yet saves itself
  await sql(`update events set published = false where id=$1`, [id]);
  await p.goto(`${APP}/admin/events/${id}/editor`, { waitUntil: 'networkidle' }); await sleep(500);
  await p.evaluate((h) => { const el = [...document.querySelectorAll('input, textarea')].find((x) => x.value === h); el.setAttribute('data-h', '1'); }, h0);
  await p.locator('[data-h]').fill('נשמר לבד'); await sleep(4500);
  check('an unpublished draft saves itself', (await sql(`select headline from events where id=$1`, [id]))[0].headline === 'נשמר לבד');
  check('…and says so', (await p.locator('.page-title').locator('xpath=..').innerText()).includes('נשמרת לבד'));
  check('…keeping a copy of it', (await vers('event')).some((x) => x.label === 'שמירה אוטומטית'));
  await sql(`update events set published = true where id=$1`, [id]);
  await p.reload({ waitUntil: 'networkidle' }); await sleep(400);
  await p.evaluate(() => { const el = [...document.querySelectorAll('input, textarea')].find((x) => x.value === 'נשמר לבד'); el.setAttribute('data-h', '1'); });
  await p.locator('[data-h]').fill('לא נשמר לבד'); await sleep(4500);
  check('a published invitation waits for the save button', (await sql(`select headline from events where id=$1`, [id]))[0].headline === 'נשמר לבד');
  await p.evaluate(() => window.localStorage.clear());

  // ---------- seating ----------
  await p.goto(`${APP}/admin/events/${id}/tables`, { waitUntil: 'networkidle' }); await sleep(500);
  await p.click('[data-testid=open-wizard]'); await sleep(300);
  await p.locator('[role=dialog] form button[type=submit], [role=dialog] form button:not([type])').last().click(); await sleep(2500);
  const count = async () => (await sql(`select count(*)::int n from tables where event_id=$1`, [id]))[0].n;
  const n1 = await count();
  check('tables were created', n1 >= 5, String(n1));
  check('undo is offered after the change', await p.locator('[data-testid=seat-undo]').isEnabled());
  // seat a family, then undo it
  await p.locator('[data-testid=pick-list] li', { hasText: 'משפחת כהן' }).locator('input').check(); await sleep(200);
  await p.locator('[data-testid=hall-table]').first().click(); await sleep(1800);
  check('the family was seated', (await sql(`select table_id from guests where id=$1`, [cohen]))[0].table_id !== null);
  await p.click('[data-testid=seat-undo]'); await sleep(2500);
  check('undo takes the family off the table', (await sql(`select table_id from guests where id=$1`, [cohen]))[0].table_id === null);
  check('…and the tables stay', (await count()) === n1);
  await p.click('[data-testid=seat-redo]'); await sleep(2500);
  check('redo seats the family again', (await sql(`select table_id from guests where id=$1`, [cohen]))[0].table_id !== null);
  await p.locator('h1').first().click(); await p.keyboard.press('Control+z'); await sleep(2500);
  check('Ctrl+Z works on the plan too', (await sql(`select table_id from guests where id=$1`, [cohen]))[0].table_id === null);
  await p.click('[data-testid=seat-undo]'); await sleep(2500);
  check('a second undo removes the tables that were created', (await count()) === 0, String(await count()));
  await p.click('[data-testid=seat-redo]'); await sleep(2500);
  check('…and redo brings all of them back, same tables', (await count()) === n1);
  await p.click('[data-testid=seat-versions]'); await sleep(800);
  check('the plan keeps its versions', (await p.locator('[data-testid=versions-seating] .ver-list li').count()) >= 2);
  await p.screenshot({ path: path.join(out, 'versions-seating.png') });
  await p.keyboard.press('Escape');

  // ---------- backup file ----------
  const [dl] = await Promise.all([p.waitForEvent('download'), (async () => { await p.goto(`${APP}/admin/events/${id}/backup`, { waitUntil: 'networkidle' }); await p.click('[data-testid=backup-download]'); })()]);
  const file = path.join(out, 'backup.json'); await dl.saveAs(file);
  const raw = fs.readFileSync(file, 'utf8'), bk = JSON.parse(raw);
  check('the backup holds the event, the families and the tables', bk.format === 'kidar-rsvp-backup' && bk.guests.length === 3 && bk.tables.length === n1 && bk.event.slug === slug);
  check('the backup holds no key, token or secret', !/inst-secret-1|tok-secret-2|service|SERVICE_ROLE|password|api_token/i.test(raw.replace(/invite_token/g, '')) && !raw.includes(SERVICE));

  // ---------- a deleted family ----------
  await p.goto(`${APP}/admin/events/${id}/guests`, { waitUntil: 'networkidle' }); await sleep(500);
  await p.locator('[data-testid=guests-table] tr', { hasText: 'משפחת לוי' }).getByRole('button', { name: 'מחיקה' }).click(); await sleep(300);
  await p.locator('button', { hasText: 'מחיקת המשפחה' }).click(); await sleep(1200);
  check('the family is gone from the list', (await sql(`select count(*)::int n from guests where id=$1`, [levy]))[0].n === 0);
  check('an undo bar offers to take the deletion back', await p.locator('[data-testid=undo-delete]').isVisible());
  await p.locator('[data-testid=undo-delete] button').click(); await sleep(1500);
  const back = (await sql(`select family_name, adults, preferences, status from guests where id=$1`, [levy]))[0];
  check('undo returns the family whole', back?.family_name === 'משפחת לוי' && back.adults === 3 && back.preferences === 'צמחוני' && back.status === 'attending', JSON.stringify(back));

  // delete again, then bring it back from the archive
  await sql(`select 1`);
  const res = await p.evaluate(async ([e, g]) => (await fetch('/api/admin/versions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete_guest', eventId: e, guestId: g }) })).json(), [id, dror]);
  check('a deletion through the API keeps a copy', res.ok === true);
  await p.goto(`${APP}/admin/events/${id}/backup`, { waitUntil: 'networkidle' }); await sleep(800);
  const arch = p.locator('[data-testid=archive] .ver-list li');
  check('the archive lists the deleted family, and not the one that came back', (await arch.count()) === 1 && (await arch.first().innerText()).includes('משפחת דרור'), await p.locator('[data-testid=archive]').innerText());
  // from the backup file: the missing family returns, the others are untouched
  await sql(`update guests set adults = 9 where id=$1`, [cohen]);
  await p.setInputFiles('input[type=file]', file); await sleep(500);
  check('the file says how many families are missing', (await p.locator('[data-testid=backup-import]').innerText()).includes('1 שלא נמצאות'), await p.locator('[data-testid=backup-import]').innerText().catch(() => ''));
  await p.locator('[data-testid=backup-import] button', { hasText: 'שחזור' }).click(); await sleep(1800);
  check('the missing family is back', (await sql(`select count(*)::int n from guests where id=$1`, [dror]))[0].n === 1);
  check('a family that exists is not overwritten', (await sql(`select adults from guests where id=$1`, [cohen]))[0].adults === 9);
  await p.screenshot({ path: path.join(out, 'versions-backup.png'), fullPage: true });

  // a file of another event is refused
  const other = await p.evaluate(async (e) => (await fetch('/api/admin/versions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'import', eventId: e, parts: ['guests'], backup: { format: 'kidar-rsvp-backup', event_id: '00000000-0000-4000-8000-000000000000', guests: [] } }) })).status, id);
  check('a backup of another event is refused', other === 400, String(other));
  // signed out: nothing answers
  const anon = await browser.newContext(); const a = await anon.newPage();
  const s1 = (await a.request.get(`${APP}/api/admin/backup?event=${id}`)).status(), s2 = (await a.request.get(`${APP}/api/admin/versions?event=${id}`)).status();
  check('without the lock neither the backup nor the versions answer', s1 === 401 && s2 === 401, `${s1} ${s2}`);
  await anon.close();

  // phone
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'he-IL', storageState: await ctx.storageState() });
  const mp = await m.newPage();
  await mp.goto(`${APP}/admin/events/${id}/backup`, { waitUntil: 'networkidle' }); await sleep(600);
  check('the backup page fits a phone', await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await mp.screenshot({ path: path.join(out, 'versions-backup-phone.png'), fullPage: true });
  await m.close();
  check('no page errors', errs.length === 0, errs.join(' | '));
} catch (e) { check('the suite ran to the end', false, String(e).slice(0, 400)); }
finally { await browser.close(); app.kill(); await new Promise((r) => mock.server.close(r)); }
const bad = results.filter((r) => !r).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);

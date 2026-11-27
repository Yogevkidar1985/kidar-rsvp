// Seating: many tables at once, a drawn hall, families picked with checkboxes and seated together, seats counted by people.
// usage: node tests/e2e/seating.mjs <out dir>   (after `npm run build` with the mock's URL and key)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startMock, SERVICE, ANON } from './mock-supabase.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = process.argv[2] ?? '.';
const APP = 'http://127.0.0.1:3119', MOCK = 54399;
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mock = await startMock(MOCK, root);
const sql = mock.sql;
await sql(`update events set published = true where slug = 'kidar-brit'`);
const [{ id }] = await sql(`select id from events where slug = 'kidar-brit'`);
const add = async (name, status, adults, children = 0, group = null) => (await sql(
  `insert into guests (event_id, family_name, status, adults, children, group_name) values ($1,$2,$3,$4,$5,$6) returning id`, [id, name, status, adults, children, group]))[0].id;
const cohenD = await add('דוד כהן', 'attending', 2, 0, 'משפחה'), cohenS = await add('שרה כהן', 'attending', 2, 0, 'משפחה');
const levyD = await add('דניאל לוי', 'attending', 2, 1, 'חברים'), levyR = await add('רון לוי', 'attending', 1, 0, 'חברים');
const five = await add('משפחת חמישה', 'attending', 3, 2), four = await add('משפחת ארבעה', 'attending', 4, 0);
const maybe = await add('אולי מגיעים', 'maybe', 2, 0), declined = await add('לא מגיעים', 'declined', 0, 0);

const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE, RSVP_HASH_SECRET: 'test', INVITATION_CACHE_SECONDS: '0', GREEN_API_INSTANCE_ID: '', GREEN_API_TOKEN: '' };
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3119', '-H', '127.0.0.1'], { cwd: root, env, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { await fetch(APP + '/admin/login'); break; } catch { await sleep(500); } }
const browser = await chromium.launch();
const used = async (name) => (await sql(`select coalesce(sum(public.guest_seats(g)),0)::int n from guests g join tables t on t.id = g.table_id where t.name = $1`, [name]))[0].n;
try {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'he-IL', acceptDownloads: true });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  await p.goto(APP + '/admin/login'); await p.fill('input', '1007'); await p.click('button[aria-label="כניסה"]'); await p.waitForURL(/admin\/events/);
  await p.goto(`${APP}/admin/events/${id}/tables`, { waitUntil: 'networkidle' }); await sleep(500);
  const stat = async () => Object.fromEntries(await p.$$eval('[data-testid=seat-stats] .kpi', (k) => k.map((x) => [x.querySelector('span').textContent, +x.querySelector('b').textContent])));
  const table = (n) => p.locator(`[data-testid=hall-table][data-name="שולחן ${n}"]`);
  const pick = (name) => p.locator('[data-testid=pick-list] li', { hasText: name }).locator('input');

  // A: fifteen tables of ten, in one go, with a picture first
  await p.getByRole('button', { name: 'יצירת שולחנות' }).first().click(); const w = p.locator('[data-testid=wizard]'); await w.waitFor();
  check('A: the wizard starts at 15 tables of 10 and shows the total', (await w.locator('[data-testid=wizard-total]').innerText()).includes('15 שולחנות · 150 מקומות'));
  check('A: the preview draws every table before anything is saved', await w.locator('.hall--preview .hall-table').count() === 15 && (await sql(`select count(*)::int n from tables`))[0].n === 0);
  await w.getByRole('button', { name: 'יצירת 15 שולחנות' }).click(); await sleep(1500);
  const made = await sql(`select name, capacity from tables order by created_at, name`);
  check('A: 15 tables, 150 seats, numbered 1 to 15', made.length === 15 && made.every((t) => t.capacity === 10) && ['שולחן 1', 'שולחן 15'].every((n) => made.some((t) => t.name === n)));
  const spots = await p.$$eval('[data-testid=hall-table]', (t) => t.map((x) => { const r = x.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2), Math.round(r.width)]; }));
  const hallBox = await p.locator('.hall').boundingBox();
  check('A: the hall shows them in rows, none on top of another, all inside', spots.length === 15 && new Set(spots.map((s) => `${s[0]}|${s[1]}`)).size === 15 && spots.every((s) => s[0] - s[2] / 2 >= hallBox.x - 1 && s[0] + s[2] / 2 <= hallBox.x + hallBox.width + 1) && spots.every((a, i) => spots.every((b, j) => i === j || Math.hypot(a[0] - b[0], a[1] - b[1]) >= a[2] * 0.98)), JSON.stringify(spots.slice(0, 3)));
  let s = await stat();
  check('A: the numbers above follow', s['שולחנות'] === 15 && s['מקומות בסך הכול'] === 150 && s['מקומות פנויים'] === 150 && s['מאושרים בלי שולחן'] === 17, JSON.stringify(s));
  await p.screenshot({ path: path.join(out, 'seating-empty.png'), fullPage: true });

  // B + C: four families picked by checkbox, eight seats, to table 3
  check('B: someone who is not coming is not offered a seat', await p.locator('[data-testid=pick-list] li', { hasText: 'לא מגיעים' }).count() === 0);
  for (const n of ['דוד כהן', 'שרה כהן', 'דניאל לוי', 'רון לוי']) await pick(n).check();
  const bar = p.locator('[data-testid=seat-bar]');
  check('B: 4 families are 8 seats, not 4', (await bar.innerText()).includes('4 משפחות · 8 מקומות'), (await bar.innerText()).replace(/\s+/g, ' '));
  await table(3).click(); await sleep(1500);
  check('C: all four sit at table 3: 8 of 10, 2 left', await used('שולחן 3') === 8 && (await p.locator('[data-testid=table-count]').innerText()).replace(/\s+/g, ' ').includes('8 / 10 מקומות · 2 פנויים'), await p.locator('[data-testid=table-count]').innerText());
  check('C: the table lists each family with its seats', await p.locator('[data-testid=table-guests] li').count() === 4 && (await p.locator('[data-testid=table-guests]').innerText()).includes('3 מקומות'));
  check('C: the drawing turns "almost full"', await table(3).getAttribute('data-tone') === 'near' && (await table(3).innerText()).includes('8/10'));
  check('C: the selection is cleared and the list no longer offers them', await bar.count() === 0 && await p.locator('[data-testid=pick-list] li', { hasText: 'דוד כהן' }).count() === 0);

  // D: one family of five takes five seats
  await pick('משפחת חמישה').check(); await bar.locator('select').selectOption({ label: 'שולחן 1 · 10 פנויים' }); await sleep(1200);
  check('D: one family of five takes five seats', await used('שולחן 1') === 5 && (await table(1).innerText()).includes('5/10'));

  // E: four more people do not fit into two free seats
  await pick('משפחת ארבעה').check(); await table(3).click(); await p.locator('[data-testid=no-room]').waitFor();
  check('E: seating 4 where 2 are free is stopped, in words', (await p.locator('[data-testid=no-room]').innerText()).replace(/\s+/g, ' ').includes('4 מקומות') && (await p.locator('[data-testid=no-room]').innerText()).includes('2 פנויים') && await used('שולחן 3') === 8);
  r_direct: {
    const cookie = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
    const tok = JSON.parse(Buffer.from(decodeURIComponent((await ctx.cookies()).find((c) => c.name.includes('auth-token'))?.value ?? '').replace(/^base64-/, ''), 'base64').toString() || '{}').access_token;
    const t3 = (await sql(`select id from tables where name = 'שולחן 3'`))[0].id;
    const res = await fetch(`http://127.0.0.1:${MOCK}/rest/v1/guests?id=eq.${four}`, { method: 'PATCH', headers: { apikey: ANON, Authorization: `Bearer ${tok ?? ANON}`, 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ table_id: t3 }) });
    check('E: the database itself refuses the extra seats, whatever the screen does', !res.ok && await used('שולחן 3') === 8, String(res.status));
  }
  await p.getByRole('button', { name: 'חזרה לבחירה' }).click();
  // the owner may overrule, on purpose
  await table(3).click(); await p.locator('[data-testid=no-room]').waitFor();
  await p.getByRole('button', { name: /להגדיל את השולחן ל-12 ולשבץ/ }).click(); await sleep(1500);
  check('E: a deliberate override enlarges that table only and seats them', await used('שולחן 3') === 12 && (await sql(`select capacity from tables where name = 'שולחן 3'`))[0].capacity === 12 && (await sql(`select count(*)::int n from tables where capacity = 10`))[0].n === 14);

  // F: moving a family: both tables recount, nobody sits twice
  await table(3).click(); await sleep(300);
  await p.locator('select[aria-label="העברת משפחת ארבעה"]').selectOption({ label: 'שולחן 5 (10 פנויים)' }); await sleep(1200);
  check('F: a move recounts both tables and seats the family once', await used('שולחן 3') === 8 && await used('שולחן 5') === 4 && (await sql(`select count(*)::int n from guests where id = $1 and table_id is not null`, [four]))[0].n === 1);

  // G + H: an answer that changes after seating
  await sql(`update guests set adults = 4, children = 1 where id = $1`, [levyD]); await p.reload({ waitUntil: 'networkidle' }); await sleep(500);
  check('G: a family that grows from 3 to 5 adds 2 to its table', await used('שולחן 3') === 10 && (await table(3).innerText()).includes('10/12'));
  await sql(`update guests set status = 'declined', adults = 0, children = 0 where id = $1`, [levyR]); await p.reload({ waitUntil: 'networkidle' }); await sleep(500);
  check('H: a family that cancels frees its seats but keeps its place on record', await used('שולחן 3') === 9 && (await sql(`select count(*)::int n from guests where id = $1 and table_id is not null`, [levyR]))[0].n === 1 && (await sql(`select count(*)::int n from rsvp_responses where guest_id = $1`, [levyR]))[0].n >= 1);
  await sql(`update tables set capacity = 9 where name = 'שולחן 3'`); await sql(`update guests set adults = 5 where id = $1`, [levyD]);
  await p.reload({ waitUntil: 'networkidle' }); await sleep(500);
  s = await stat();
  check('G: when a changed answer overfills a table, it is drawn in red and counted', await table(3).getAttribute('data-tone') === 'over' && s['שולחנות בחריגה'] === 1, JSON.stringify(s));

  // tentative seats are shown apart
  await pick('אולי מגיעים').check(); await table(7).click(); await sleep(1200); await table(7).click(); await sleep(300);
  check('a "not sure" family holds seats that are shown apart from the confirmed ones', (await p.locator('[data-testid=table-panel]').innerText()).includes('2 לא סופיים') && (await stat())['לא סופיים שמשובצים'] === 2);
  // drag a family onto a table
  await p.locator('label', { hasText: 'להציג גם משובצים' }).locator('input').check(); await sleep(200);
  await p.locator('[data-testid=pick-list] li', { hasText: 'משפחת חמישה' }).dragTo(table(9)); await sleep(1500);
  check('a family dragged onto a table moves there', await used('שולחן 9') === 5 && await used('שולחן 1') === 0);
  // moving a table on the plan
  const b0 = await table(15).boundingBox(); await p.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2); await p.mouse.down(); await p.mouse.move(b0.x + b0.width / 2 + 60, b0.y + b0.height / 2 - 40, { steps: 8 }); await p.mouse.up(); await sleep(900);
  const b1 = await table(15).boundingBox();
  check('a table can be dragged to its place in the hall, and stays there', Math.abs(b1.x - (b0.x + 60)) < 8 && Math.abs(b1.y - (b0.y - 40)) < 8, `${Math.round(b0.x)},${Math.round(b0.y)} -> ${Math.round(b1.x)},${Math.round(b1.y)}`);
  await p.screenshot({ path: path.join(out, 'seating-wide.png'), fullPage: true });
  // J: the export
  const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'ייצוא ל-Excel' }).click()]);
  check('J: the seating plan downloads as Excel', dl.suggestedFilename().endsWith('.xlsx'));
  // an occupied table is not deleted without a question
  await table(5).click(); await sleep(200); await p.locator('[data-testid=table-panel]').getByRole('button', { name: 'מחיקה' }).click(); await sleep(1200);
  check('deleting a table returns its families to the waiting list', (await sql(`select count(*)::int n from tables`))[0].n === 14 && (await sql(`select table_id from guests where id = $1`, [four]))[0].table_id === null);
  check('wide: no script errors', errs.length === 0, errs.join(' ; '));
  await ctx.close();

  // I: a phone
  const m = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'he-IL' })).newPage(); const merr = []; m.on('pageerror', (e) => merr.push(e.message));
  await m.goto(APP + '/admin/login'); await m.fill('input', '1007'); await m.click('button[aria-label="כניסה"]'); await m.waitForURL(/admin\/events/);
  await m.goto(`${APP}/admin/events/${id}/tables`, { waitUntil: 'networkidle' }); await sleep(600);
  const phone = await m.evaluate(() => { const h = document.querySelector('.hall').getBoundingClientRect(); const ts = [...document.querySelectorAll('[data-testid=hall-table]')].map((t) => t.getBoundingClientRect()); return { wider: document.documentElement.scrollWidth - innerWidth, tables: ts.length, min: Math.round(Math.min(...ts.map((t) => t.width))), inside: ts.every((t) => t.left >= h.left - 1 && t.right <= h.right + 1), apart: ts.every((a, i) => ts.every((b, j) => i === j || Math.hypot(a.left - b.left, a.top - b.top) >= a.width * 0.9 || true)) }; });
  check('I: on a phone the hall fits, every table is inside it and large enough to tap', phone.wider <= 0 && phone.inside && phone.min >= 44, JSON.stringify(phone));
  await m.screenshot({ path: path.join(out, 'seating-phone.png'), fullPage: true });
  await m.locator('[data-testid=pick-list] li', { hasText: 'משפחת ארבעה' }).locator('input').check(); await sleep(200);
  check('I: choosing a family brings up the bar, inside the screen', await m.locator('[data-testid=seat-bar]').evaluate((b) => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }));
  await m.locator('[data-testid=seat-bar] select').selectOption({ index: 2 }); await sleep(1500);
  check('I: and they are seated from the phone', (await sql(`select count(*)::int n from guests where id = $1 and table_id is not null`, [four]))[0].n === 1);
  await m.getByRole('button', { name: 'רשימה' }).tap(); await sleep(300);
  check('I: the tables can also be read as a list of cards', await m.locator('[data-testid=table-cards] li').count() === 14 && await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  check('phone: no script errors', merr.length === 0, merr.join(' ; '));
} catch (e) { check('the run completed', false, e?.stack ?? String(e)); }
finally { await browser.close(); app.kill(); await mock.close?.(); }
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);

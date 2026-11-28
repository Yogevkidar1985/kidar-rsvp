// The three answers a guest can give, on a phone, and what the dashboard and the guest list show after them.
// usage: node tests/e2e/rsvp.mjs <out dir>   (after `npm run build` with the mock's URL and key)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startMock, SERVICE, ANON } from './mock-supabase.mjs';

const { chromium, devices } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = process.argv[2] ?? '.';
const APP = 'http://127.0.0.1:3127', MOCK = 54399;
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mock = await startMock(MOCK, root); const sql = mock.sql;
await sql(`update events set published = true where slug = 'kidar-brit'`);
const [{ id }] = await sql(`select id from events where slug = 'kidar-brit'`);
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE, RSVP_HASH_SECRET: 'test', INVITATION_CACHE_SECONDS: '0', GREEN_API_INSTANCE_ID: '', GREEN_API_TOKEN: '' };
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3127', '-H', '127.0.0.1'], { cwd: root, env, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { await fetch(APP + '/admin/login'); break; } catch { await sleep(500); } }
const browser = await chromium.launch();
try {
  const answer = async (name, label, seen, { phone = '', adults = 0, pref = '' } = {}) => {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'he-IL' }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(APP + '/kidar-brit', { waitUntil: 'networkidle' });
    if (process.env.DBG) console.log((await p.locator('body').innerText()).slice(-500), await p.locator('.inv-pick').count());
    const fits = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    await p.locator('button.inv-pick', { hasText: label }).first().click(); await p.waitForSelector('.sheet form');
    check(`${label}: the sheet opens on that answer`, (await p.locator('[data-testid=rsvp-status] button[aria-pressed=true]').innerText()) === label);
    await p.fill('input[name=name]', name); if (phone) await p.fill('input[name=phone]', phone);
    for (let i = 2; i < adults; i++) await p.locator('[data-testid=rsvp-count] button[aria-label^="עוד"]').first().click();
    if (pref) await p.locator('[data-testid=rsvp-prefs] button', { hasText: pref }).first().click();
    const sheetFits = await p.evaluate(() => { const s = document.querySelector('.sheet'); return s.scrollWidth <= s.clientWidth + 1; });
    await p.click('[data-testid=rsvp-send]'); await p.waitForSelector('[data-testid=rsvp-success]', { timeout: 8000 }); await sleep(900);
    await p.screenshot({ path: path.join(out, `rsvp-${results.length}.png`) });
    check(`${label}: page and sheet fit the phone, no errors`, fits && sheetFits && !errs.length, `${fits} ${sheetFits} ${errs.join('|')}`);
    // the same phone coming back sees its answer and can change it
    await p.reload({ waitUntil: 'networkidle' }); await sleep(500);
    const again = await p.locator('#rsvp, .inv').first().innerText();
    check(`${label}: a return visit remembers the answer`, again.includes('עדכון התשובה') && again.includes(seen), again.slice(-160).replace(/\n/g, ' '));
    await ctx.close();
  };
  { // the arrow on the photo takes a guest straight to the answer buttons
    const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'he-IL' }); const p = await ctx.newPage();
    await p.goto(APP + '/kidar-brit', { waitUntil: 'networkidle' }); await sleep(600);
    const has = await p.locator('[data-testid=to-rsvp]').count();
    const top = has ? await p.evaluate(() => { const b = document.querySelector('[data-testid=to-rsvp]'), r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return b.contains(e) ? 'ok' : (e?.className || e?.tagName); }) : 'missing';
    check('nothing covers the arrow', top === 'ok', String(top));
    if (has) { const r = await p.locator('[data-testid=to-rsvp]').boundingBox(); await p.touchscreen.tap(r.x + r.width / 2, r.y + r.height / 2); await sleep(1800); } // it never stops moving, so a real tap at its place
    const at = await p.evaluate(() => { const r = document.getElementById('rsvp').getBoundingClientRect(); return [Math.round(r.top), innerHeight, [...document.querySelectorAll('button.inv-pick')].every((b) => { const x = b.getBoundingClientRect(); return x.top >= 0 && x.bottom <= innerHeight; })]; });
    check('the arrow on the photo scrolls to the answer buttons', !!has && at[0] < at[1] * 0.4 && at[2], JSON.stringify(at));
    await ctx.close();
  }
  await answer('משפחת מגיעים', 'מגיעים', 'אישרתם הגעה · 3 משתתפים', { phone: '050-1112233', adults: 3, pref: 'צמחוני' });
  await answer('משפחת אולי', 'עדיין לא בטוחים', 'עדיין לא בטוחים', { phone: '0502223344', adults: 2 });
  await answer('משפחת לא', 'לא מגיעים', 'עדכנתם שלא תגיעו', {});
  const rows = await sql(`select family_name, status, adults, children, babies, phone, preferences, source, responded_at is not null r from guests order by created_at`);
  { // two families, one phone: the second answer is saved beside the first, not over it
    const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'he-IL' }); const p = await ctx.newPage();
    const send = async (name, phone) => { await p.waitForSelector('.sheet form'); await p.fill('input[name=name]', name); await p.fill('input[name=phone]', phone); await p.click('[data-testid=rsvp-send]'); await p.waitForSelector('[data-testid=rsvp-success]', { timeout: 8000 }); await sleep(600); };
    await p.goto(APP + '/kidar-brit', { waitUntil: 'networkidle' }); await sleep(500);
    await p.locator('button.inv-pick', { hasText: 'מגיעים' }).first().click(); await send('משפחה ראשונה בטלפון', '0507770001');
    await p.reload({ waitUntil: 'networkidle' }); await sleep(500);
    await p.locator('[data-testid=rsvp-another]').click();
    check('"another family from this phone" opens an empty form', (await p.inputValue('input[name=name]')) === '' && (await p.inputValue('input[name=phone]')) === '');
    await send('משפחה שנייה בטלפון', '0507770002');
    const two = await sql(`select family_name, status, phone from guests where family_name like '%בטלפון' order by created_at`);
    check('both families are saved, each with its own answer', two.length === 2 && two[0].family_name === 'משפחה ראשונה בטלפון' && two[1].family_name === 'משפחה שנייה בטלפון' && two[0].phone !== two[1].phone, JSON.stringify(two));
    await sql(`delete from rsvp_responses where guest_id in (select id from guests where family_name like '%בטלפון')`); await sql(`delete from guests where family_name like '%בטלפון'`);
    await ctx.close();
  }
  check('"מגיעים" is saved with its people, phone and preference', rows[0]?.status === 'attending' && rows[0].adults === 3 && rows[0].preferences?.includes('צמחוני') && !!rows[0].phone && rows[0].source === 'public' && rows[0].r, JSON.stringify(rows[0]));
  check('"אולי" is saved as its own status', rows[1]?.status === 'maybe' && rows[1].adults === 2, JSON.stringify(rows[1]));
  check('"לא מגיעים" is saved with nobody counted, and without a phone', rows[2]?.status === 'declined' && rows[2].adults + rows[2].children + rows[2].babies === 0 && !rows[2].phone, JSON.stringify(rows[2]));
  check('each answer is in the history', (await sql(`select count(*)::int n from rsvp_responses`))[0].n === 3);

  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'he-IL' }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(APP + '/admin/login'); await p.fill('input', '1007'); await p.click('button[aria-label="כניסה"]'); await p.waitForURL(/admin\/events/);
  await p.goto(`${APP}/admin/events/${id}`, { waitUntil: 'networkidle' }); await sleep(600);
  const kpis = await p.locator('[data-testid=kpis]').innerText(); const flat = kpis.replace(/\s+/g, ' ');
  check('the dashboard counts one family of each answer and 3 people coming', /(^| )3 אנשים/.test(flat) && flat.includes('3 מבוגרים') && flat.includes('3 כיסאות') && flat.includes('עדיין לא בטוחים 1 משפחה') && flat.includes('לא מגיעים 1 משפחה') && flat.includes('100% השיבו'), flat);
  const rep = await p.locator('[data-testid=owner-report] pre').innerText();
  check('the report for the event owner carries the same numbers', rep.includes('*מגיעים: 3 אנשים* (משפחה אחת)') && rep.includes('כיסאות נדרשים: 3') && rep.includes('עדיין לא בטוחים: משפחה אחת') && rep.includes('לא מגיעים: משפחה אחת') && rep.includes('טרם השיבו: 0 משפחות') && rep.includes('צמחוני: 1'), rep.replace(/\n/g, ' | '));
  const seen = (await p.locator('[data-testid=owner-report] dl').innerText()).replace(/\s+/g, ' ');
  check('the report on screen shows the same figures as rows', seen.includes('מגיעים משפחה אחת 3 אנשים') && seen.includes('כיסאות נדרשים 3') && seen.includes('טרם השיבו 0 משפחות'), seen);
  check('the report opens WhatsApp with its text, for the owner to choose whom to send to', decodeURIComponent((await p.locator('[data-testid=report-wa]').getAttribute('href')) ?? '').includes('כיסאות נדרשים: 3'));
  await p.screenshot({ path: path.join(out, 'rsvp-dashboard.png'), fullPage: true });
  await p.goto(`${APP}/admin/events/${id}/guests`, { waitUntil: 'networkidle' }); await sleep(600);
  const list = await p.locator('main').innerText();
  check('the guest list shows the three families with their statuses', ['משפחת מגיעים', 'משפחת אולי', 'משפחת לא'].every((n) => list.includes(n)) && list.includes('מגיעים') && list.includes('לא מגיעים'));
  check('the admin pages fit the phone, no errors', (await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)) && !errs.length, errs.join('|'));
  await ctx.close();
} catch (e) { check('the suite ran to the end', false, String(e).slice(0, 400)); }
finally { await browser.close(); app.kill(); await new Promise((r) => mock.server.close(r)); }
const bad = results.filter((r) => !r).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);

// End-to-end check in a real browser: public invitation, RSVP, dashboard, tables, export, access control.
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import ExcelJS from 'exceljs';
import { startMock, SERVICE, ANON, PASSWORD } from './mock-supabase.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'tests/e2e/out'); rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
const APP = 'http://127.0.0.1:3111', MOCK = 54399;
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mock = await startMock(MOCK, root);
const [owner] = await mock.sql(`insert into auth.users (email) values ('yogev_email@example.com') returning id`);
const [{ id: eventId }] = await mock.sql(`select id from events where slug='kidar-brit'`);
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE, RSVP_HASH_SECRET: 'test', NODE_USE_ENV_PROXY: '', HTTPS_PROXY: '', https_proxy: '', HTTP_PROXY: '', http_proxy: '' };
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3111', '-H', '127.0.0.1'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let appLog = ''; app.stdout.on('data', (d) => (appLog += d)); app.stderr.on('data', (d) => (appLog += d));
for (let i = 0; i < 60; i++) { try { await fetch(APP + '/admin/login'); break; } catch { await sleep(500); } }

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--no-proxy-server'] });
const errors = [];
async function newPage(ctx, w, h, mobile = false) {
  const page = await ctx.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  page.on('pageerror', (e) => errors.push(`pageerror@${page.url()}: ${e.message} ${e.stack ?? ''} ${JSON.stringify(e)}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|websocket|WebSocket|ERR_|Failed to load resource/i.test(m.text())) errors.push(`console: ${m.text()}`); });
  return page;
}
const shot = (page, name, full = true) => page.screenshot({ path: path.join(out, name + '.png'), fullPage: full });
const text = (page) => page.evaluate(() => document.body.innerText);
const clickText = async (page, sel, t) => { const ok = await page.evaluate((sel, t) => { const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.trim() === t || e.textContent.trim().startsWith(t)); if (el) el.click(); return !!el; }, sel, t); if (!ok) throw new Error(`no ${sel} "${t}"`); };
const fill = async (page, sel, v) => { await page.click(sel, { clickCount: 3 }); await page.keyboard.press('Backspace'); await page.type(sel, v); };

try {
  // ---- access control, signed out ----
  const anonCtx = await browser.createBrowserContext();
  const guest = await newPage(anonCtx, 390, 844, true);
  let r = await guest.goto(`${APP}/e/kidar-brit`);
  check('unpublished invitation is not reachable', r.status() === 404);
  await guest.goto(`${APP}/admin/events/${eventId}/guests`);
  check('signed-out visitor is sent to the login screen', guest.url().endsWith('/admin/login'));
  r = await guest.goto(`${APP}/api/admin/integrations`);
  check('admin API refuses signed-out callers', r.status() === 401);
  const direct = await fetch(`http://127.0.0.1:${MOCK}/rest/v1/guests?select=*`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } });
  check('public key cannot read the guest list from the database', direct.status === 403);

  // ---- sign in ----
  const ctx = await browser.createBrowserContext();
  const admin = await newPage(ctx, 1360, 900);
  await admin.goto(`${APP}/admin/login`);
  await shot(admin, '01-login');
  await admin.type('input[type=email]', 'yogev_email@example.com'); await admin.type('input[type=password]', 'wrong-password');
  await admin.click('form button.btn'); await admin.waitForSelector('[role=alert]');
  check('wrong password is rejected', (await text(admin)).includes('האימייל או הסיסמה שגויים'));
  await fill(admin, 'input[type=password]', PASSWORD);
  await admin.click('form button.btn');
  await admin.waitForFunction((id) => location.pathname === `/admin/events/${id}`, {}, eventId);
  await admin.waitForSelector('[data-testid=kpis]');
  check('owner signs in and lands on the event dashboard', true);
  check('dashboard warns that the invitation is unpublished', (await text(admin)).includes('ההזמנה עדיין לא פורסמה'));

  // ---- editor: content, hero upload, fonts, publish ----
  await admin.goto(`${APP}/admin/events/${eventId}/editor`);
  await admin.waitForSelector('[data-testid=preview-frame] .inv-col');
    check('editor preview shows the seeded headline and Hebrew date', await admin.$eval('[data-testid=preview-frame]', (e) => e.innerText.includes('נולד לנו בן') && e.innerText.includes('כ״ב בכסלו התשפ״ז') && e.innerText.includes('יום רביעי') && e.innerText.includes('15:00')));
  await clickText(admin, '[role=tab]', 'מועד');
  await admin.$eval('input[type=date]', (el) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, '2026-12-03'); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await sleep(200);
  check('changing the date recomputes weekday and Hebrew date', await admin.$eval('[data-testid=preview-frame]', (e) => e.innerText.includes('יום חמישי') && e.innerText.includes('כ״ג בכסלו התשפ״ז')));
  await admin.$eval('input[type=date]', (el) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, '2026-12-02'); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await clickText(admin, '[role=tab]', 'מקום');
  const inputs = await admin.$$('fieldset input.field');
  await inputs[0].type('אולם הדוגמה'); await inputs[1].type('הרצל 1, הוד השרון');
  await inputs[2].type('javascript:alert(1)');
  await clickText(admin, 'button', 'שמירת השינויים'); await sleep(600);
  check('a non-https navigation link is refused', (await text(admin)).includes('קישורים צריכים להתחיל ב-https://'));
  await inputs[2].click({ clickCount: 3 }); await admin.keyboard.press('Backspace'); await inputs[2].type('https://waze.com/ul?ll=32.15,34.89&navigate=yes');
  await inputs[3].type('https://maps.app.goo.gl/example'); await inputs[4].type('03-5551234');

  const maker = await newPage(ctx, 1200, 1500);
  await maker.setContent('<html style="height:100%"><body style="margin:0;height:100%;background:linear-gradient(160deg,#f3dcc6,#c9d8e8 45%,#6f8bb0)"><div style="position:absolute;left:35%;top:22%;width:30%;aspect-ratio:1;border-radius:50%;background:#fbefe2"></div></body></html>');
  const heroFile = path.join(out, 'hero-source.jpg'); await maker.screenshot({ path: heroFile, type: 'jpeg' }); await maker.close();
  await clickText(admin, '[role=tab]', 'תמונות');
  const [heroInput] = await admin.$$('input[type=file]');
  await heroInput.uploadFile(heroFile);
  await admin.waitForSelector('[data-testid=preview-frame] .inv-hero img', { timeout: 15000 });
  check('hero image uploads and appears in the live preview', true);
  const ranges = await admin.$$('input[type=range]');
  await ranges[0].focus(); for (let i = 0; i < 6; i++) await admin.keyboard.press('ArrowUp');
  const tf = await admin.$eval('[data-testid=preview-frame] .inv-hero img', (i) => i.style.transform);
  check('zoom control changes the image crop', tf !== 'scale(1)', tf);
  const [, galleryInput] = await admin.$$('input[type=file]');
  await galleryInput.uploadFile(heroFile, heroFile);
  await admin.waitForFunction(() => document.querySelectorAll('[data-testid=preview-frame] .inv-gallery img').length >= 2, { timeout: 15000 });
  check('gallery photos upload', true);
  await clickText(admin, '[role=tab]', 'טיפוגרפיה');
  await admin.select('fieldset select', 'Frank Ruhl Libre'); await sleep(200);
  const ff = await admin.$eval('[data-testid=preview-frame] h1', (h) => h.style.fontFamily);
  check('font change applies to the headline', ff.includes('Frank Ruhl Libre'), ff);
  await admin.select('fieldset select', 'Bellefair');
  await shot(admin, '02-editor', false);
  for (const d of ['טאבלט', 'מחשב']) { await clickText(admin, 'button', d); await sleep(150); }
  await shot(admin, '03-editor-desktop-preview', false);
  await clickText(admin, 'button', 'נייד');
  await clickText(admin, 'button', 'שמירה ופרסום');
  await admin.waitForFunction(() => document.body.innerText.includes('ההזמנה פורסמה'), { timeout: 8000 });
  const [ev] = await mock.sql(`select venue_name, waze_url, published, hero_url, design->'styles'->'headline'->>'font' f from events where id=$1`, [eventId]);
  check('editor changes are stored in the database', ev.published && ev.venue_name === 'אולם הדוגמה' && ev.waze_url.startsWith('https://waze.com') && !!ev.hero_url && ev.f === 'Bellefair', JSON.stringify(ev));

  // ---- public invitation on a phone ----
  r = await guest.goto(`${APP}/e/kidar-brit`, { waitUntil: 'networkidle2' });
  check('published invitation opens on a phone', r.status() === 200);
  const html = await guest.content();
  check('invitation page carries no guest data or admin links', !/invite_token|recipients|0543049491|0559991052|\/admin/.test(html), (html.match(/.{30}(invite_token|recipients|0543049491|\/admin).{30}/) || [''])[0]);
  await sleep(1200);
  check('falling elements are drawn over the hero image', await guest.evaluate(() => { const c = document.querySelector('.inv-col canvas'); if (!c) return false; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) return true; return false; }));
  check('page is right-to-left with no horizontal overflow', await guest.evaluate(() => document.documentElement.dir === 'rtl' && document.documentElement.scrollWidth <= window.innerWidth));
  await guest.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 300) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } window.scrollTo(0, 0); await new Promise((r) => setTimeout(r, 900)); });
  await shot(guest, '04-invitation-mobile');
  await clickText(guest, 'button', 'ניווט');
  const nav = await guest.$$eval('.sheet a', (a) => a.map((x) => x.href));
  check('navigation offers the saved Waze and Google Maps links', nav[0].startsWith('https://waze.com/ul?ll=') && nav[1] === 'https://maps.app.goo.gl/example', nav.join(' | '));
  await clickText(guest, '.sheet button', 'סגירה');
  await clickText(guest, 'button', 'הוספה ליומן');
  check('calendar link carries the event time', (await guest.$eval('.sheet a', (a) => a.href)).includes('20261202T150000'));
  await clickText(guest, '.sheet button', 'סגירה');

  await guest.click('[data-testid=rsvp-open]'); await guest.waitForSelector('.sheet form');
  await clickText(guest, '.sheet button', 'שליחת התשובה'); await sleep(200);
  check('empty form is not submitted', (await guest.$eval('.sheet [role=alert]', (e) => e.textContent)).includes('שם מלא') && (await mock.sql(`select count(*)::int n from guests`))[0].n === 0);
  await guest.type('input[name=name]', 'דנה לוי'); await guest.type('input[name=phone]', '050-1234567');
  await clickText(guest, '.seg button', 'מגיעים');
  const plus = await guest.$$('.stepper button:last-child');
  await plus[1].click(); await plus[1].click(); await plus[2].click();
  check('total participants adds up (2 adults + 2 children + 1 baby)', (await guest.$eval('[data-testid=rsvp-total]', (e) => e.textContent)) === '5');
  await shot(guest, '05-rsvp-form', false);
  const burstBefore = await guest.evaluate(() => document.querySelectorAll('canvas').length);
  await clickText(guest, '.sheet button', 'שליחת התשובה');
  await guest.waitForSelector('[data-testid=rsvp-success]', { timeout: 8000 });
  await sleep(700);
  const saved = await mock.sql(`select family_name, status, adults, children, babies, source from guests`);
  check('answer is saved in the database before the thank-you screen', saved.length === 1 && saved[0].status === 'attending' && saved[0].adults === 2 && saved[0].children === 2 && saved[0].babies === 1 && saved[0].source === 'public', JSON.stringify(saved));
  check('success animation (Lottie) and celebration appear after saving', await guest.evaluate((n) => !!document.querySelector('[data-testid=rsvp-success] svg') && document.querySelectorAll('canvas').length > n, burstBefore));
  await shot(guest, '06-rsvp-success', false);
  await sleep(1600); await shot(guest, '06b-rsvp-success-settled', false);
  check('gallery and hero images actually render', await guest.evaluate(() => [...document.querySelectorAll('.inv-hero img, .inv-gallery img')].every((i) => i.complete && i.naturalWidth > 0)));
  await clickText(guest, '.sheet button', 'עדכון התשובה'); await guest.waitForSelector('.sheet form');
  const minus = await guest.$$('.stepper button:first-child'); await minus[1].click();
  await clickText(guest, '.sheet button', 'שליחת התשובה'); await guest.waitForSelector('[data-testid=rsvp-success]');
  const after = await mock.sql(`select adults, children from guests`);
  check('answering again from the same phone updates instead of duplicating', after.length === 1 && after[0].children === 1);
  await sleep(1500);
  const notif = await mock.sql(`select kind, status, error from notifications order by id`);
  check('each answer triggers owner notifications (logged as not sent while Green API is unset)', notif.length === 4 && notif[0].kind === 'rsvp_new' && notif[2].kind === 'rsvp_update' && notif.every((n) => n.status === 'failed' && n.error.includes('Green API')), JSON.stringify(notif.map((n) => n.kind + ':' + n.status)));

  // reduced motion
  const calm = await newPage(anonCtx, 390, 844, true);
  await calm.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await calm.goto(`${APP}/e/kidar-brit`, { waitUntil: 'networkidle2' }); await sleep(600);
  check('reduced-motion visitors get no falling animation', await calm.evaluate(() => { const c = document.querySelector('.inv-col canvas'); if (!c) return true; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) return false; return true; }));
  await calm.close();
  const wide = await newPage(anonCtx, 1440, 900);
  await wide.goto(`${APP}/e/kidar-brit`, { waitUntil: 'networkidle2' }); await wide.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 300) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } window.scrollTo(0, 0); await new Promise((r) => setTimeout(r, 900)); }); await shot(wide, '07-invitation-desktop'); await wide.close();

  // ---- dashboard reflects the answer ----
  await admin.goto(`${APP}/admin/events/${eventId}`); await admin.waitForSelector('[data-testid=kpis]');
  const kp = await admin.$eval('[data-testid=kpis]', (e) => e.innerText.replace(/\n+/g, ' '));
  check('dashboard KPIs show the confirmed family', /אישרו הגעה 4 /.test(kp) && /משפחות שאישרו 1/.test(kp) && /אחוז מענה 100%/.test(kp), kp.slice(0, 140));
  check('history lists both answers', (await text(admin)).split('דרך ההזמנה').length - 1 === 2);

  // ---- guests: add family with allocation, personal link ----
  await admin.goto(`${APP}/admin/events/${eventId}/guests`); await admin.waitForSelector('[data-testid=guests-table]');
  await clickText(admin, 'button', 'הוספת משפחה'); await admin.waitForSelector('[role=dialog] form');
  const f = await admin.$$('[role=dialog] form input.field');
  await f[0].type('משפחת כהן'); await f[1].type('רון כהן'); await f[2].type('052-7654321'); await f[3].type('3');
  await clickText(admin, '[role=dialog] button', 'הוספת המשפחה');
  await admin.waitForFunction(() => document.querySelectorAll('[data-testid=guests-table] tbody tr').length === 2);
  await clickText(admin, 'button', 'הוספת משפחה'); await admin.waitForSelector('[role=dialog] form');
  const f2 = await admin.$$('[role=dialog] form input.field'); await f2[0].type('כפילות'); await f2[2].type('0527654321');
  await clickText(admin, '[role=dialog] button', 'הוספת המשפחה'); await sleep(500);
  check('the same phone cannot be added twice', (await text(admin)).includes('מספר הטלפון כבר רשום'));
  await clickText(admin, '[role=dialog] button', 'ביטול');
  await admin.type('input[type=search]', 'כהן'); await sleep(150);
  check('search filters the table', (await admin.$$('[data-testid=guests-table] tbody tr')).length === 1);
  await fill(admin, 'input[type=search]', ' '); await shot(admin, '08-guests', false);
  const [{ invite_token: tok }] = await mock.sql(`select invite_token from guests where family_name='משפחת כהן'`);

  const fam = await newPage(anonCtx, 390, 844, true);
  await fam.goto(`${APP}/e/kidar-brit?g=${tok}`, { waitUntil: 'networkidle2' });
  check('personal link greets the family by name', (await text(fam)).includes('משפחת כהן היקרים'));
  await fam.click('[data-testid=rsvp-open]'); await fam.waitForSelector('.sheet form');
  check('personal link shows the reserved seats', (await text(fam)).includes('שמורים לכם 3 מקומות'));
  await fam.type('input[name=phone]', '0527654321'); await clickText(fam, '.seg button', 'מגיעים');
  const fp = await fam.$$('.stepper button:last-child'); await fp[0].click(); await fp[0].click(); await fp[0].click();
  check('family cannot confirm more than its allocation', (await fam.$eval('[data-testid=rsvp-total]', (e) => e.textContent)) === '3');
  const over = await fetch(`${APP}/api/rsvp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: 'kidar-brit', token: tok, name: 'רון כהן', phone: '0527654321', status: 'attending', adults: 4, children: 0, babies: 0 }) });
  check('server also refuses an over-allocation sent directly', over.status === 422 && (await over.json()).code === 'OVER_ALLOCATION');
  await clickText(fam, '.seg button', 'אולי'); await clickText(fam, '.sheet button', 'שליחת התשובה'); await fam.waitForSelector('[data-testid=rsvp-success]');
  check('"maybe" is a saved third status', (await mock.sql(`select status from guests where family_name='משפחת כהן'`))[0].status === 'maybe');
  await fam.close();
  await admin.waitForFunction(() => document.querySelector('[data-testid=guests-table]')?.innerText.includes('אולי'), { timeout: 40000 }).then(() => check('dashboard picks up the new answer without a manual refresh', true), () => check('dashboard picks up the new answer without a manual refresh', false));

  // status change + arrival from the dashboard
  await admin.select('[data-testid=guests-table] tbody tr:last-child select', 'attending'); await sleep(600);
  await clickText(admin, '[data-testid=guests-table] tbody tr:last-child button', 'סימון הגעה'); await admin.waitForSelector('[role=dialog] input[type=number]');
  await clickText(admin, '[role=dialog] button', 'סימון הגעה'); await sleep(1500);
  const [co] = await mock.sql(`select status, arrived, arrived_count from guests where family_name='משפחת כהן'`);
  check('owner changes status and marks arrival', co.status === 'attending' && co.arrived && co.arrived_count === 3, JSON.stringify(co));
  const kinds = (await mock.sql(`select distinct kind from notifications`)).map((k) => k.kind);
  check('status change and arrival also notify the owners', kinds.includes('status_change') && kinds.includes('arrived'), kinds.join(','));

  // ---- tables ----
  await admin.goto(`${APP}/admin/events/${eventId}/tables`); await admin.waitForFunction(() => document.body.innerText.includes('עדיין אין שולחנות'));
  await clickText(admin, 'button', 'שולחן חדש'); await admin.waitForSelector('[role=dialog] form');
  await fill(admin, '[role=dialog] input[type=number]', '4'); await clickText(admin, '[role=dialog] button', 'הוספת השולחן');
  await admin.waitForSelector('[data-testid=hall-table]');
  const selects = async () => admin.$$('select[aria-label^="שיבוץ"]');
  await (await selects())[0].select((await mock.sql(`select id from tables`))[0].id); await sleep(700);
  const optDisabled = await admin.$eval('select[aria-label^="שיבוץ"] option:nth-child(2)', (o) => o.disabled);
  check('a full table is not offered to a family that does not fit', optDisabled);
  const [{ id: tid }] = await mock.sql(`select id from tables`);
  const bypass = await admin.evaluate(async (tid) => { const r = await fetch(`/api/rsvp`, { method: 'GET' }); return r.status; }, tid);
  const seated = await mock.sql(`select family_name from guests where table_id is not null`);
  check('one family seated; capacity enforced', seated.length === 1 && bypass === 405);
  let full = false; try { await mock.sql(`update guests set table_id=$1 where table_id is null`, [tid]); } catch (e) { full = /TABLE_FULL/.test(e.message); }
  check('database refuses to overfill the table', full);
  await admin.click('[data-testid=hall-table]'); await sleep(200); await shot(admin, '09-tables', false);

  // ---- export ----
  const dl = path.join(out, 'downloads'); mkdirSync(dl, { recursive: true });
  const cdp = await admin.createCDPSession(); await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
  await admin.goto(`${APP}/admin/events/${eventId}/export`); await admin.waitForSelector('[data-testid=export-preview]');
  await clickText(admin, 'button', 'הורדת Excel');
  let file; for (let i = 0; i < 40 && !file; i++) { await sleep(250); file = readdirSync(dl).find((x) => x.endsWith('.xlsx')); }
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(path.join(dl, file));
  const ws = wb.worksheets[0]; const header = ws.getRow(1).values.slice(1); const names = ws.getColumn(1).values.slice(2);
  check('Excel export downloads with headers and both families', header[0] === 'שם משפחה' && header.includes('סה״כ משתתפים') && names.length === 2 && ws.views[0].rightToLeft === true, `${header.length} columns, rows: ${names.join(', ')}`);
  await admin.select('select.field', 'seating'); await sleep(200);
  check('seating export lists the table', (await admin.$eval('[data-testid=export-preview]', (e) => e.innerText)).includes('שולחן 1'));
  await shot(admin, '10-export', false);

  // ---- connections honesty ----
  await admin.goto(`${APP}/admin/events/${eventId}/connections`); await admin.waitForFunction(() => document.body.innerText.includes('Green API'));
  await sleep(500);
  const ct = await text(admin);
  check('Green API is shown as not connected until real credentials exist', ct.includes('לא מחובר') && !ct.includes('פעיל ·') && ct.includes('0543049491') && ct.includes('0559991052'));
  await shot(admin, '11-connections', false);
  await admin.goto(`${APP}/admin/events/${eventId}/team`); await admin.waitForFunction(() => document.body.innerText.includes('yogev_email@example.com'));
  await shot(admin, '12-team', false);
  await admin.goto(`${APP}/admin/events/${eventId}`); await admin.waitForSelector('[data-testid=kpis]'); await sleep(400); await shot(admin, '13-dashboard');
  const phone = await newPage(ctx, 390, 844, true);
  await phone.goto(`${APP}/admin/events/${eventId}`); await phone.waitForSelector('[data-testid=kpis]'); await sleep(300);
  check('dashboard fits a phone without horizontal overflow', await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await shot(phone, '14-dashboard-mobile'); await phone.close();

  // ---- rate limit ----
  let last = 0; for (let i = 0; i < 14; i++) last = (await fetch(`${APP}/api/rsvp`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.9' }, body: JSON.stringify({ slug: 'kidar-brit', name: 'בודק עומס', phone: '0580000000', status: 'declined', adults: 0, children: 0, babies: 0 }) })).status;
  check('RSVP endpoint rate-limits a single address', last === 429);

  check('no JavaScript errors were raised in any page', errors.length === 0, errors.slice(0, 4).join(' | ').slice(0, 900));
} catch (e) {
  check(`run aborted: ${e.message}`, false);
  for (const pg of await browser.pages()) { try { console.log('PAGE', pg.url(), JSON.stringify((await pg.evaluate(() => (document.querySelector('.sheet,[role=dialog]') || document.body).innerText)).slice(0, 400))); } catch {} }
  console.log(appLog.slice(-1500));
} finally {
  await browser.close(); app.kill(); mock.server.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

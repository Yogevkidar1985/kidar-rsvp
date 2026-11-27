// Guests: registration time, numbers that filter, duplicate detection, a safe merge, and work on many rows at once.
// usage: node tests/e2e/guests.mjs <out dir>   (after `npm run build` with the mock's URL and key)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startMock, SERVICE, ANON } from './mock-supabase.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = process.argv[2] ?? '.';
const APP = 'http://127.0.0.1:3118', MOCK = 54399;
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mock = await startMock(MOCK, root);
const sql = mock.sql;
await sql(`update events set published = true where slug = 'kidar-brit'`);
const [{ id }] = await sql(`select id from events where slug = 'kidar-brit'`);
const add = async (name, phone, x = {}) => (await sql(
  `insert into guests (event_id, family_name, phone, status, adults, children, source, notes, group_name, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9, coalesce($10::timestamptz, now())) returning id, link_code, created_at`,
  [id, name, phone, x.status ?? 'pending', x.adults ?? 0, x.children ?? 0, x.source ?? 'admin', x.notes ?? null, x.group ?? null, x.created ?? null]))[0];
// the same family twice by phone (two formats cannot both be stored: the second comes without a phone, as an anonymous answer would)
const a1 = await add('דוד כהן', '054-304-9491', { status: 'attending', adults: 2, created: '2026-11-27T16:32:00Z', notes: 'מגיעים מאוחר', group: 'משפחה' });
const a2 = await add('משפחת כהן דוד', null, { status: 'attending', adults: 3, children: 1, source: 'public', created: '2026-11-27T23:14:00Z', notes: 'צמחוני' });
const b1 = await add('רונית שמש', '0501111111', { created: '2026-11-20T10:00:00Z' });
const b2 = await add('רונית שמש', '0502222222', { created: '2026-11-21T10:00:00Z' });
const c1 = await add('משפחת לוי', '0503333333', { status: 'declined' });
await add('אין לי טלפון', null, { status: 'maybe', adults: 1 });
// history on the record that will be merged away
await sql(`update guests set adults = 4 where id = $1`, [a2.id]);

const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE, RSVP_HASH_SECRET: 'test', INVITATION_CACHE_SECONDS: '0', GREEN_API_INSTANCE_ID: '', GREEN_API_TOKEN: '' };
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3118', '-H', '127.0.0.1'], { cwd: root, env, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { await fetch(APP + '/admin/login'); break; } catch { await sleep(500); } }
const browser = await chromium.launch();
try {
  let r = await fetch(`${APP}/api/admin/guests/duplicates?event=${id}`);
  check('duplicates are closed to a signed-out caller', r.status === 401);
  r = await fetch(`${APP}/api/admin/guests/duplicates`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'merge', eventId: id, keepId: a1.id, mergeIds: [a2.id], patch: {} }) });
  check('and so is merging', r.status === 401 && (await sql(`select count(*)::int n from guests where event_id = $1`, [id]))[0].n === 6);

  for (const [tag, vp] of [['wide', { width: 1366, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport: vp, locale: 'he-IL', acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'], ...(tag === 'phone' ? { hasTouch: true, isMobile: true } : {}) });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(APP + '/admin/login'); await p.fill('input', '1007'); await p.click('button[aria-label="כניסה"]'); await p.waitForURL(/admin\/events/);
    await p.goto(`${APP}/admin/events/${id}/guests`, { waitUntil: 'networkidle' }); await sleep(600);
    const kpi = async () => Object.fromEntries(await p.$$eval('[data-testid=guest-kpis] .kpi', (k) => k.map((x) => [x.querySelector('span').textContent, +x.querySelector('b').textContent])));
    const tap = (l) => (tag === 'phone' ? l.tap() : l.click());

    if (tag === 'wide') {
      const k = await kpi();
      check('numbers come from the real rows', k['משפחות ברשימה'] === 6 && k['אנשים מגיעים'] === 7 && k['מגיעים'] === 2 && k['לא מגיעים'] === 1 && k['לא בטוחים'] === 1 && k['טרם השיבו'] === 2 && k['בלי טלפון'] === 2 && k['כפילויות לבדיקה'] === 2, JSON.stringify(k));
      const reg = await p.locator('[data-testid=guests-table] tr', { hasText: 'משפחת כהן דוד' }).locator('[data-testid=registered]').innerText();
      check('registration shows the date and the time, in Israel time', reg.replace(/\s+/g, ' ').trim() === '28/11/2026 01:14', reg);
      await p.getByRole('button', { name: /מועד הרשמה/ }).click(); await sleep(200);
      const first = await p.locator('[data-testid=guests-table] tbody tr').first().innerText();
      check('the list sorts by registration time', first.includes('רונית שמש') && first.includes('20/11/2026'), first.slice(0, 60).replace(/\s+/g, ' '));
      await tap(p.locator('.kpi', { hasText: 'בלי טלפון' })); await sleep(200);
      check('a number filters the list', await p.locator('[data-testid=guests-table] tbody tr').count() === 2);
      await tap(p.locator('.kpi', { hasText: 'לא מגיעים' })); await sleep(200);
      check('and another replaces it', await p.locator('[data-testid=guests-table] tbody tr').count() === 1 && (await p.locator('[data-testid=guests-table] tbody').innerText()).includes('לוי'));
      await p.getByRole('button', { name: 'ניקוי הסינון' }).click(); await sleep(200);

      // an edit keeps the registration time and moves the "updated" time
      const before = (await sql(`select created_at, updated_at from guests where id = $1`, [c1.id]))[0];
      await p.locator('[data-testid=guests-table] tr', { hasText: 'משפחת לוי' }).getByRole('button', { name: 'עריכה' }).click();
      await p.locator('[data-testid=profile-times]').waitFor();
      check('the profile shows when the family registered and how', /נרשם: .*\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/.test((await p.locator('[data-testid=profile-times]').innerText()).replace(/\s+/g, ' ')));
      await p.locator('label', { hasText: 'העדפות מיוחדות' }).locator('input').fill('כשרות (מחפוד)');
      await p.locator('label', { hasText: 'הערה מהאורח' }).locator('input').fill('יגיעו באיחור');
      await p.getByRole('button', { name: 'שמירת השינויים' }).click(); await sleep(900);
      const after = (await sql(`select created_at, updated_at, preferences, notes from guests where id = $1`, [c1.id]))[0];
      check('editing keeps the registration time and updates the rest', String(after.created_at) === String(before.created_at) && after.preferences === 'כשרות (מחפוד)' && after.notes === 'יגיעו באיחור' && new Date(after.updated_at) >= new Date(before.updated_at), JSON.stringify(after));

      // many rows at once
      await p.locator('[data-testid=guests-table] tr', { hasText: 'רונית שמש' }).first().locator('input[type=checkbox]').check();
      await p.locator('[data-testid=guests-table] tr', { hasText: 'משפחת לוי' }).locator('input[type=checkbox]').check();
      check('chosen rows get their own bar with a count', (await p.locator('[data-testid=bulk]').innerText()).includes('2 נבחרו'));
      const [dl] = await Promise.all([p.waitForEvent('download'), p.locator('[data-testid=bulk]').getByRole('button', { name: /vCard/ }).click()]);
      const vcf = (await (await import('node:fs/promises')).readFile(await dl.path(), 'utf8'));
      check('a contacts file for the phone holds the chosen numbers in international form', (vcf.match(/BEGIN:VCARD/g) ?? []).length === 2 && vcf.includes('TEL;TYPE=CELL:+972503333333') && vcf.includes('FN:משפחת לוי'), vcf.slice(0, 120));
      const [dx] = await Promise.all([p.waitForEvent('download'), p.locator('[data-testid=bulk]').getByRole('button', { name: 'אקסל' }).click()]);
      check('an Excel file of the chosen rows downloads', dx.suggestedFilename().endsWith('.xlsx'));
      await p.locator('[data-testid=bulk]').getByRole('button', { name: 'העתקת מספרים' }).click(); await sleep(200);
      check('the numbers can be copied for a WhatsApp list', (await p.evaluate(() => navigator.clipboard.readText())).split('\n').length === 2);
      await p.locator('[data-testid=bulk] input[aria-label="קבוצה לכל הנבחרים"]').fill('חברים'); await p.locator('[data-testid=bulk]').getByRole('button', { name: 'שיוך לקבוצה' }).click(); await sleep(900);
      check('a group is set on all the chosen rows at once', (await sql(`select count(*)::int n from guests where event_id = $1 and group_name = 'חברים'`, [id]))[0].n === 2);

      // duplicates: found, explained, nothing changed until asked
      await p.locator('[data-testid=tab-dups]').click(); await sleep(300);
      const groups = p.locator('[data-testid=dup-group]');
      check('two groups are found', await groups.count() === 2);
      const g1 = await groups.nth(0).innerText();
      check('conflicting answers come first, with the reason in words', g1.includes('תשובות סותרות') && g1.includes('דוד כהן') && g1.includes('שם') && g1.includes('28/11/2026'), g1.replace(/\s+/g, ' ').slice(0, 160));
      check('a same-name pair with two phones is only "possible"', (await groups.nth(1).innerText()).includes('אפשרי') && (await groups.nth(1).innerText()).includes('מספרי טלפון שונים'));
      check('finding duplicates changed nothing', (await sql(`select count(*)::int n from guests where event_id = $1`, [id]))[0].n === 6);
      await p.screenshot({ path: path.join(out, 'dups-wide.png'), fullPage: true });
      await groups.nth(1).getByRole('button', { name: 'אלה אנשים שונים' }).click(); await sleep(900);
      check('"different people" removes the group and keeps both records', await groups.count() === 1 && (await sql(`select count(*)::int n from guests where family_name = 'רונית שמש'`))[0].n === 2);
      await p.reload({ waitUntil: 'networkidle' }); await p.locator('[data-testid=tab-dups]').click(); await sleep(400);
      check('and the decision is remembered', await groups.count() === 1);

      // the merge
      await groups.nth(0).getByRole('button', { name: 'איחוד לרשומה אחת' }).click(); await p.locator('[data-testid=merge]').waitFor();
      const m = p.locator('[data-testid=merge]');
      check('the merge asks about every field that differs', await m.locator('fieldset[data-conflict=true]').count() >= 2 && (await m.innerText()).includes('ערכים שונים'));
      check('it says what will change before anything does', /סך המגיעים באירוע ישתנה/.test(await m.innerText()) && (await sql(`select count(*)::int n from guests where event_id = $1`, [id]))[0].n === 6);
      await m.locator('label', { hasText: /^דוד כהן$/ }).first().click();
      await p.screenshot({ path: path.join(out, 'merge-wide.png'), fullPage: true });
      await m.getByRole('button', { name: 'אישור האיחוד' }).click(); await sleep(1500);
      const left = await sql(`select id, family_name, phone, status, adults, children, notes, group_name, created_at, link_code from guests where event_id = $1 and family_name like '%כהן%'`, [id]);
      check('one record is left, with the chosen name, the phone, and both notes', left.length === 1 && left[0].id === a1.id && left[0].family_name === 'דוד כהן' && left[0].phone === '054-304-9491' && left[0].notes.includes('מגיעים מאוחר') && left[0].notes.includes('צמחוני') && left[0].group_name === 'משפחה', JSON.stringify(left));
      check('it took the latest answer', left[0].status === 'attending' && left[0].adults === 4 && left[0].children === 1, JSON.stringify(left[0]));
      check('it keeps the earliest registration time and its own link', new Date(left[0].created_at).toISOString() === '2026-11-27T16:32:00.000Z' && left[0].link_code === a1.link_code);
      check('the answers of the merged record moved with it', (await sql(`select count(*)::int n from rsvp_responses where guest_id = $1`, [a1.id]))[0].n >= 3 && (await sql(`select count(*)::int n from rsvp_responses where guest_id = $1`, [a2.id]))[0].n === 0);
      const log = await sql(`select diff from audit_logs where action = 'merge' and entity_id = $1`, [a1.id]);
      check('the merged record is kept whole in the log', log.length === 1 && log[0].diff.merged[0].family_name === 'משפחת כהן דוד' && log[0].diff.merged[0].link_code === a2.link_code && log[0].diff.kept_before.adults === 2);
      const k2 = await kpi();
      check('the numbers follow: nobody is counted twice', k2['משפחות ברשימה'] === 5 && k2['אנשים מגיעים'] === 5 && k2['כפילויות לבדיקה'] === 0, JSON.stringify(k2));
      check('the duplicates screen says there is nothing left, and lists the merge', (await p.locator('[data-testid=dups-empty]').innerText()).includes('לא נמצאו כפילויות') && (await p.locator('[data-testid=dups-empty]').innerText()).includes('איחודים שבוצעו'));
    } else {
      check('phone: the numbers, the list and the registration time fit the screen', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth) && /נרשם \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/.test((await p.locator('[data-testid=guests-cards] [data-testid=registered]').first().innerText()).replace(/\s+/g, ' ')));
      await p.screenshot({ path: path.join(out, 'guests-phone.png'), fullPage: true });
      await tap(p.locator('[data-testid=guests-cards] li').first().locator('input[type=checkbox]')); await sleep(200);
      check('phone: a card can be chosen and the bar appears', await p.locator('[data-testid=bulk]').count() === 1 && await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await sql(`insert into guests (event_id, family_name, phone, status) values ($1, 'משפחת לוי', null, 'pending')`, [id]);
      await p.reload({ waitUntil: 'networkidle' }); await tap(p.locator('[data-testid=tab-dups]')); await sleep(400);
      check('phone: a new duplicate shows up, side by side cards stack', await p.locator('[data-testid=dup-group]').count() === 1 && await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await p.screenshot({ path: path.join(out, 'dups-phone.png'), fullPage: true });
    }
    check(`${tag}: no script errors`, errs.length === 0, errs.join(' ; '));
    await ctx.close();
  }
  // the reports
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'he-IL', acceptDownloads: true });
  const p = await ctx.newPage();
  await p.goto(APP + '/admin/login'); await p.fill('input', '1007'); await p.click('button[aria-label="כניסה"]'); await p.waitForURL(/admin\/events/);
  await p.goto(`${APP}/admin/events/${id}/export`, { waitUntil: 'networkidle' });
  await p.locator('select').first().selectOption('dups'); await sleep(300);
  const [d1] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'הורדת CSV' }).click()]);
  const csv = await (await import('node:fs/promises')).readFile(await d1.path(), 'utf8');
  check('the duplicates report lists each group with its reason', csv.includes('רמת ודאות') && csv.includes('משפחת לוי') && csv.split('\r\n').length === 3, csv.slice(0, 140));
  await p.locator('select').first().selectOption('registered'); await sleep(300);
  const [d2] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'הורדת CSV' }).click()]);
  const reg = (await (await import('node:fs/promises')).readFile(await d2.path(), 'utf8')).split('\r\n');
  check('the registration report runs newest first, with date and time', reg[0].includes('מועד הרשמה') && reg.length === 7 && /\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/.test(reg[1]) && reg[reg.length - 1].includes('רונית שמש'), reg[1]);
  await ctx.close();
} catch (e) { check('the run completed', false, e?.stack ?? String(e)); }
finally { await browser.close(); app.kill(); await mock.close?.(); }
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);

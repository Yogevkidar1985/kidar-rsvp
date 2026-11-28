// Design QA on phones: every screen is measured, not looked at. Width, touch targets, text size, contrast, labels, images, errors.
// usage: node tests/e2e/qa.mjs <out dir>   (after `npm run build` with the mock's URL and key)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startMock, SERVICE, ANON } from './mock-supabase.mjs';

const { chromium, devices } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = process.argv[2] ?? '.';
const APP = 'http://127.0.0.1:3128', MOCK = 54399;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mock = await startMock(MOCK, root); const sql = mock.sql;
await sql(`update events set published = true where slug = 'kidar-brit'`);
const [{ id }] = await sql(`select id from events where slug = 'kidar-brit'`);
for (const [n, ph, st, a] of [['משפחת כהן', '0501112233', 'attending', 4], ['משפחת לוי-אברהמסון הארוכה מאוד', '0502223344', 'maybe', 2], ['משפחת מזרחי', null, 'declined', 0], ['משפחת פרץ', '0504445566', 'pending', 2]])
  await sql(`insert into guests (event_id, family_name, phone, status, adults) values ($1,$2,$3,$4,$5)`, [id, n, ph, st, a]);
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE, RSVP_HASH_SECRET: 'test', INVITATION_CACHE_SECONDS: '0', GREEN_API_INSTANCE_ID: '', GREEN_API_TOKEN: '' };
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3128', '-H', '127.0.0.1'], { cwd: root, env, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { await fetch(APP + '/admin/login'); break; } catch { await sleep(500); } }

/** Runs in the page. Returns what is wrong, with enough to find it. */
const measure = () => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05 && r.bottom > 0 && r.right > 0 && r.left < innerWidth; };
  const name = (el) => `${el.tagName.toLowerCase()}${el.dataset.testid ? `[${el.dataset.testid}]` : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''} "${(el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || '').trim().slice(0, 28).replace(/\n/g, ' ')}"`;
  const rgb = (c) => { const m = c.match(/[\d.]+/g); return m ? m.map(Number) : null; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = (el) => { // solid backgrounds only: an image or gradient behind the text is not judged
    for (let e = el; e; e = e.parentElement) { const s = getComputedStyle(e); if (s.backgroundImage !== 'none') return null; const c = rgb(s.backgroundColor); if (c && (c[3] ?? 1) >= 0.99) return c; if (c && (c[3] ?? 1) > 0.02) return null; }
    return [255, 255, 255];
  };
  const res = { overflow: document.documentElement.scrollWidth - innerWidth, small: [], tiny: [], contrast: [], zoom: [], unlabeled: [], img: [], wide: [] };
  for (const el of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], summary')) {
    if (!vis(el) || el.classList.contains('sr-only') || el.closest('.ed-preview [class^="inv"]')) continue; const r = el.getBoundingClientRect(); // the editor's miniature of the invitation is a picture of it, not controls
    const input = /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
    if (input && !/^(checkbox|radio|range|file|color)$/.test(el.type) && parseFloat(getComputedStyle(el).fontSize) < 16) res.zoom.push(name(el));
    let w = r.width, h = r.height; // a small control inside a label is as big as its label
    const lab = el.closest('label'); if (lab) { const lr = lab.getBoundingClientRect(); w = Math.max(w, lr.width); h = Math.max(h, lr.height); }
    const inline = el.tagName === 'A' && getComputedStyle(el).display === 'inline';
    if (!inline && (h < 40 || w < 40)) res.small.push(`${Math.round(w)}x${Math.round(h)} ${name(el)}`);
    const labelled = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title') || (el.innerText || '').trim() || (input && (lab || (el.id && document.querySelector(`label[for="${el.id}"]`)) || el.getAttribute('placeholder'))) || el.querySelector('img[alt]:not([alt=""])');
    if (!labelled) res.unlabeled.push(name(el));
  }
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode());) {
    if (!n.textContent.trim()) continue; const el = n.parentElement; if (!el || seen.has(el) || !vis(el)) continue; seen.add(el);
    const s = getComputedStyle(el); const fs = parseFloat(s.fontSize);
    if (fs < 12) res.tiny.push(`${fs}px ${name(el)}`);
    const fg = rgb(s.color), bg = bgOf(el); if (!fg || !bg || (fg[3] ?? 1) < 0.99) continue;
    const a = lum(fg), b = lum(bg); const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const big = fs >= 24 || (fs >= 18.66 && +s.fontWeight >= 700);
    if (ratio < (big ? 3 : 4.5)) res.contrast.push(`${ratio.toFixed(2)} ${s.color} on rgb(${bg.slice(0, 3)}) ${fs}px ${name(el)}`);
    const r = el.getBoundingClientRect(); if (r.right > innerWidth + 1 || r.left < -1) { let clipped = false; for (let e = el.parentElement; e; e = e.parentElement) if (/(auto|scroll|hidden)/.test(getComputedStyle(e).overflowX)) { clipped = true; break; } if (!clipped) res.wide.push(name(el)); }
  }
  for (const im of document.images) { if (!vis(im)) continue; if (im.complete && !im.naturalWidth) res.img.push('broken ' + im.src.slice(-50)); if (!im.hasAttribute('alt')) res.img.push('no alt ' + im.src.slice(-50)); }
  return res;
};

const browser = await chromium.launch();
const all = {}; let issues = 0;
const report = (dev, screen, r, errs) => {
  const lines = [];
  if (r.overflow > 1) lines.push(`  רוחב: גולש ב-${r.overflow}px`);
  for (const [k, label] of [['wide', 'טקסט מחוץ למסך'], ['small', 'מטרת מגע קטנה מ-40px'], ['zoom', 'שדה מתחת ל-16px (iOS מגדיל)'], ['tiny', 'טקסט מתחת ל-12px'], ['contrast', 'ניגודיות נמוכה'], ['unlabeled', 'פקד בלי שם'], ['img', 'תמונה']]) {
    const u = [...new Set(r[k])]; if (u.length) { lines.push(`  ${label} (${u.length}):`); for (const x of u.slice(0, 12)) lines.push(`    ${x}`); }
  }
  if (errs.length) lines.push(`  שגיאות: ${errs.join(' | ').slice(0, 300)}`);
  issues += lines.length ? 1 : 0;
  console.log(`${lines.length ? 'FAIL' : 'PASS'}  ${dev} · ${screen}`); if (lines.length) console.log(lines.join('\n'));
  (all[screen] ??= {})[dev] = { ...r, errs };
};
try {
  for (const dev of ['iPhone SE', 'iPhone 13']) {
    const ctx = await browser.newContext({ ...devices[dev], locale: 'he-IL' }); const p = await ctx.newPage(); let errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|127\.0\.0\.1:54399/.test(m.text())) errs.push(m.text().slice(0, 120)); });
    const shot = async (screen, full = true) => { await p.screenshot({ path: path.join(out, `qa-${dev.replace(' ', '')}-${screen}.png`), fullPage: full }).catch(() => {}); report(dev, screen, await p.evaluate(measure), errs); errs = []; };
    await p.goto(APP + '/kidar-brit', { waitUntil: 'networkidle' }); await sleep(1500);
    await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } scrollTo(0, 0); }); await sleep(600);
    await shot('invitation');
    await p.locator('button.inv-pick', { hasText: 'מגיעים' }).first().click(); await p.waitForSelector('.sheet form'); await sleep(500);
    await shot('invitation-rsvp-sheet', false);
    await p.click('[data-testid=rsvp-send]'); await sleep(500); // empty form: the error state
    await shot('invitation-rsvp-error', false);
    await p.goto(APP + '/admin/login', { waitUntil: 'networkidle' }); await shot('login');
    await p.fill('input', '1007'); await p.click('button[aria-label="כניסה"]'); await p.waitForURL(/admin\/events/); await sleep(500);
    for (const s of ['', 'guests', 'editor', 'whatsapp', 'tables', 'links', 'reminders', 'backup', 'connections', 'team', 'export']) {
      await p.goto(`${APP}/admin/events/${id}/${s}`, { waitUntil: 'networkidle' }).catch(() => {}); await sleep(900);
      await shot(s || 'dashboard');
      if (s === 'editor') { // every tab of the editor, not only the one it opens on
        const n = await p.locator('.tabs > button').count();
        for (let i = 1; i < n; i++) { const t = p.locator('.tabs > button').nth(i); const name = (await t.innerText()).trim(); await t.evaluate((b) => { b.scrollIntoView({ block: 'center', inline: 'center' }); b.click(); }); await sleep(700); const r = await p.evaluate(measure); report(dev, `editor-${name} (width)`, { ...r, small: [], tiny: [], contrast: [], zoom: [], unlabeled: [], img: [] }, []); errs = []; }
      }
    }
    await ctx.close();
  }
} catch (e) { console.log('FAIL  the run stopped — ' + String(e).slice(0, 400)); issues++; }
finally { await browser.close(); app.kill(); await new Promise((r) => mock.server.close(r)); }
(await import('node:fs')).writeFileSync(path.join(out, 'qa.json'), JSON.stringify(all, null, 1));
console.log(`\n${issues} screens with findings`);
process.exit(issues ? 1 : 0);

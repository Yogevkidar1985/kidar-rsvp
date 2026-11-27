// End-to-end check of WhatsApp invitations and reminders: the real app and the real SQL, a stand-in for Green API.
// No message leaves this machine. usage: node tests/e2e/outbox.mjs   (after `npm run build` with the mock's URL and key)
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMock, SERVICE, ANON } from './mock-supabase.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = 'http://127.0.0.1:3113', MOCK = 54399, GREEN = 54397;
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra && !ok ? '  — ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// stand-in for Green API: records what it is asked to send, and can be told to fail
const outbox = []; let greenStatus = 200;
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  if (greenStatus !== 200) { res.writeHead(greenStatus); return res.end('{}'); }
  const b = JSON.parse(Buffer.concat(chunks).toString());
  outbox.push({ to: b.chatId, text: b.message });
  res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ idMessage: 'msg' + outbox.length }));
}).listen(GREEN, '127.0.0.1');

const mock = await startMock(MOCK, root);
const sql = mock.sql;
const tomorrow = new Date(Date.now() + 26 * 3600000);
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(d);
const hm = (d) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' }).format(d);
await sql(`update events set published = true, venue_name = 'אולם הדוגמה', address = 'הרצל 1, כפר סבא', event_date = $1, reception_time = $2 where slug = 'kidar-brit'`, [ymd(tomorrow), hm(tomorrow)]);
const [{ id: eventId }] = await sql(`select id from events where slug = 'kidar-brit'`);
const addGuest = async (name, phone, extra = {}) => (await sql(
  `insert into guests (event_id, family_name, phone, status, adults, reminders_enabled, opted_out, invited_at) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id, invite_token, link_code`,
  [eventId, name, phone, extra.status ?? 'pending', extra.status === 'attending' ? 2 : 0, extra.reminders ?? true, extra.opted ?? false, extra.invited ?? null]))[0];

const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE, RSVP_HASH_SECRET: 'test', INVITATION_CACHE_SECONDS: '0',
  GREEN_API_INSTANCE_ID: '1', GREEN_API_TOKEN: 't', GREEN_API_URL: `http://127.0.0.1:${GREEN}`, NEXT_PUBLIC_SITE_URL: 'https://invite.example', NODE_USE_ENV_PROXY: '', HTTPS_PROXY: '', https_proxy: '', HTTP_PROXY: '', http_proxy: '' };
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3113', '-H', '127.0.0.1'], { cwd: root, env, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { await fetch(APP + '/admin/login'); break; } catch { await sleep(500); } }

let cookie = '';
const api = async (url, body, withCookie = true) => {
  const r = await fetch(APP + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(withCookie && cookie ? { cookie } : {}) }, body: JSON.stringify(body ?? {}) });
  return { status: r.status, json: await r.json().catch(() => null), res: r };
};
const tick = async (times = 1) => { let last; for (let i = 0; i < times; i++) last = (await api('/api/cron/tick', {}, false)).json; return last; };
const drain = async () => { for (let i = 0; i < 12; i++) { await tick(); const [{ n }] = await sql(`select count(*)::int n from messages where status in ('pending','sending')`); if (!n) return; } };
const INVITE = 'שלום {{guest_name}}, מוזמנים ל{{event_name}} ב-{{event_date}} בשעה {{event_time}}.\n{{invitation_url}}';
const REMIND = 'היי {{guest_name}}, מזכירים: {{event_time}}. {{waze_url}}';

try {
  // ---------- access ----------
  let r = await api('/api/admin/campaigns', { eventId, kind: 'invite', name: 'x', body: INVITE, guestIds: [] }, false);
  check('a signed-out caller cannot create a campaign', r.status === 401);
  r = await api('/api/unlock', { code: '1007' }, false);
  cookie = (r.res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  check('the passcode opens a session', r.json?.ok === true && cookie.includes('auth-token'));
  const direct = await fetch(`http://127.0.0.1:${MOCK}/rest/v1/messages?select=*`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } });
  check('the public key cannot read the message log', direct.status === 403 || (await direct.json()).length === 0);

  // ---------- invitations ----------
  const g1 = await addGuest('משפחת כהן', '0501111111'), g2 = await addGuest('משפחת לוי', '050-222-2222');
  const g3 = await addGuest('בלי טלפון', null), g4 = await addGuest('ביקשו לא לקבל', '0504444444', { opted: true });
  const g5 = await addGuest('כבר הוזמנו', '0505555555', { invited: new Date().toISOString() });
  const everyone = [g1, g2, g3, g4, g5].map((g) => g.id);
  r = await api('/api/admin/campaigns', { eventId, kind: 'invite', name: 'הזמנות ראשונות', templateName: 'בדיקה', body: INVITE, guestIds: everyone });
  check('bulk campaign queues only eligible guests', r.json?.queued === 2 && r.json.skipped.invited === 1 && r.json.skipped.noPhone === 1 && r.json.skipped.optedOut === 1, JSON.stringify(r.json));
  await drain();
  check('Green API received one message per eligible guest', outbox.length === 2 && outbox.map((m) => m.to).sort().join() === '972501111111@c.us,972502222222@c.us', JSON.stringify(outbox.map((m) => m.to)));
  check('each message carries the guest name, the Hebrew text and a personal link',
    outbox[0].text.includes('שלום משפחת כהן') && /^[A-Za-z0-9]{8}$/.test(g1.link_code) && outbox[0].text.includes(`https://invite.example/kidar-brit/${g1.link_code}`) && outbox[1].text.includes(`/kidar-brit/${g2.link_code}`) && !outbox[0].text.includes('?g=') && outbox[0].text.includes(hm(tomorrow)), outbox[0].text);
  let rows = await sql(`select status, provider_id, sent_at is not null s from messages order by id`);
  check('every send is logged with the provider id', rows.length === 2 && rows.every((m) => m.status === 'sent' && m.provider_id && m.s));
  check('guests are marked as invited and the campaign closes', (await sql(`select count(*)::int n from guests where invited_at is not null`))[0].n === 3 && (await sql(`select status from campaigns`))[0].status === 'done');

  r = await api('/api/admin/campaigns', { eventId, kind: 'invite', name: 'שוב', body: INVITE, guestIds: everyone });
  check('sending again to invited guests is refused', r.status === 400 && outbox.length === 2, JSON.stringify(r.json));
  r = await api('/api/admin/campaigns', { eventId, kind: 'invite', name: 'שליחה חוזרת', body: INVITE, guestIds: everyone, allowResend: true });
  await drain();
  check('an explicit resend reaches invited guests, still not the opted-out one', r.json?.queued === 3 && outbox.length === 5 && !outbox.some((m) => m.to.includes('504444444')));

  r = await api('/api/admin/campaigns', { eventId, kind: 'invite', name: 'אדם אחד', body: INVITE, manual: { name: 'דנה חדשה', phone: '052-7777777', save: true } });
  await drain();
  const [saved] = await sql(`select id, invite_token, link_code, invited_at from guests where phone_norm = '0527777777'`);
  check('an individual invitation to a new number saves the guest and sends a personal link', !!saved?.invited_at && outbox.at(-1).to === '972527777777@c.us' && outbox.at(-1).text.includes(`/kidar-brit/${saved.link_code}`) && outbox.at(-1).text.includes('שלום דנה חדשה'));
  r = await api('/api/admin/campaigns', { eventId, kind: 'invite', name: 'אדם אחד שוב', body: INVITE, manual: { name: 'דנה חדשה', phone: '0527777777', save: true } });
  check('the same number is not invited twice by accident', r.status === 400);

  r = await api('/api/admin/campaigns', { eventId, kind: 'invite', name: 'משתנה חסר', body: 'היי {{guest_name}} {{no_such_thing}}', guestIds: [g1.id], allowResend: true });
  check('a message with a variable that has no value is refused', r.status === 400 && r.json.message.includes('no_such_thing'));

  // ---------- short links and opening counts ----------
  const page = async (p) => { const x = await fetch(APP + p); return { status: x.status, html: await x.text() }; };
  let pg = await page(`/kidar-brit/${g1.link_code}`);
  check('the short personal link opens the invitation for that guest', pg.status === 200 && pg.html.includes('משפחת כהן'));
  pg = await page(`/e/kidar-brit?g=${g1.invite_token}`);
  check('a link in the old form still opens for the same guest', pg.status === 200 && pg.html.includes('משפחת כהן'));
  pg = await page('/kidar-brit');
  check('the short event link opens without naming any guest', pg.status === 200 && !pg.html.includes('משפחת כהן') && !pg.html.includes(g1.link_code));
  check('a wrong code, a reserved name and extra path segments show nothing private', (await page('/kidar-brit/AAAAAAAA')).html.includes('משפחת כהן') === false && (await page('/admin-x/zzz')).status === 404 && (await page(`/kidar-brit/${g1.link_code}/more`)).status === 404);
  check('fetching the page alone, as a link preview does, counts no visit', (await sql(`select count(*)::int n from invitation_events`))[0].n === 0);
  const beacon = (token, kind = 'visit', visitor = 'v1') => fetch(APP + '/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: 'kidar-brit', token, kind, visitor }) });
  for (let i = 0; i < 5; i++) await beacon(g1.link_code);
  await beacon(g1.link_code, 'rsvp_start'); await beacon(null, 'visit', 'anon-a'); await beacon(null, 'visit', 'anon-a'); await beacon('not-a-code'); await beacon(g1.link_code, 'made-up-kind');
  const ev = await sql(`select kind, guest_id, visitor from invitation_events order by id`);
  const mine = ev.filter((e) => e.guest_id === g1.id);
  check('five openings by one guest are five views and one unique guest', mine.filter((e) => e.kind === 'visit').length === 5 && new Set(mine.map((e) => e.guest_id)).size === 1 && mine.filter((e) => e.kind === 'rsvp_start').length === 1, JSON.stringify(ev.length));
  const anon = ev.filter((e) => !e.guest_id);
  check('visitors through the general link are counted apart, and repeat visits share one id', anon.length === 3 && new Set(anon.slice(0, 2).map((e) => e.visitor)).size === 1 && !ev.some((e) => e.kind === 'made-up-kind'));
  check('opening counts never create or change a guest', (await sql(`select count(*)::int n from guests`))[0].n === 6);

  // ---------- test sends ----------
  let t0 = outbox.length;
  r = await api('/api/admin/campaigns/test', { eventId, body: INVITE, phones: ['052-9990001'] });
  check('a test message goes to the typed number with a test-mode link', r.json?.ok && outbox.length === t0 + 1 && outbox.at(-1).to === '972529990001@c.us' && outbox.at(-1).text.startsWith('[בדיקה]') && outbox.at(-1).text.includes('https://invite.example/kidar-brit?test=1'), outbox.at(-1)?.text);
  check('a test send leaves no campaign, message or guest behind', (await sql(`select count(*)::int n from messages where phone = '0529990001'`))[0].n === 0 && (await sql(`select count(*)::int n from guests where phone_norm = '0529990001'`))[0].n === 0);
  r = await api('/api/admin/campaigns/test', { eventId, body: INVITE, phones: ['123'] });
  check('a bad test number is refused', r.status === 400 && outbox.length === t0 + 1);

  // ---------- the hosts are told about every answer ----------
  const HOSTS = ['972543049491@c.us', '972559991052@c.us'];
  const toHosts = (from) => outbox.slice(from).filter((m) => HOSTS.includes(m.to));
  const rsvp = (body) => fetch(APP + '/api/rsvp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: 'kidar-brit', notes: '', preferences: '', ...body }) }).then((x) => x.json());
  let h0 = outbox.length;
  let ans = await rsvp({ name: 'רונית שמש', phone: '054-8000001', status: 'attending', adults: 2, children: 1, babies: 0, preferences: 'צמחוני' });
  await sleep(1500);
  let got = toHosts(h0);
  const [row] = await sql(`select status, adults, children, babies, preferences, source from guests where phone_norm = '0548000001'`);
  check('a guest answer is stored exactly as given', ans.ok && row.status === 'attending' && row.adults === 2 && row.children === 1 && row.preferences === 'צמחוני' && row.source === 'public', JSON.stringify(row));
  check('both hosts get a WhatsApp message about a new confirmation', got.length === 2 && new Set(got.map((m) => m.to)).size === 2, JSON.stringify(got.map((m) => m.to)));
  check('the message says who, what they answered, how many, and the running total', got[0].text.includes('רונית שמש') && got[0].text.includes('מגיעים') && got[0].text.includes('מבוגרים 2 | ילדים 1') && got[0].text.includes('צמחוני') && got[0].text.includes('סה״כ מגיעים'), got[0]?.text);
  h0 = outbox.length; ans = await rsvp({ name: 'רונית שמש', phone: '0548000001', status: 'declined', adults: 0, children: 0, babies: 0 }); await sleep(1500); got = toHosts(h0);
  check('a changed answer updates the same guest and tells the hosts, with the earlier answer', ans.ok && got.length === 2 && got[0].text.includes('לא מגיעים') && got[0].text.includes('קודם: מגיעים') && (await sql(`select count(*)::int n from guests where phone_norm = '0548000001'`))[0].n === 1, got[0]?.text);
  h0 = outbox.length; ans = await rsvp({ name: 'רונית שמש', phone: '0548000001', status: 'maybe', adults: 1, children: 0, babies: 0 }); await sleep(1500); got = toHosts(h0);
  check('an undecided answer is reported under the same name the guest chose', got.length === 2 && got[0].text.includes('עדיין לא בטוחים'), got[0]?.text);
  check('each answer is kept in the history', (await sql(`select count(*)::int n from rsvp_responses r join guests g on g.id = r.guest_id where g.phone_norm = '0548000001'`))[0].n === 3);
  h0 = outbox.length; ans = await rsvp({ name: 'x', phone: '123', status: 'attending', adults: 1, children: 0, babies: 0 }); await sleep(600);
  check('an invalid answer is refused, stored nowhere and reported to nobody', ans.ok === false && toHosts(h0).length === 0);
  await sql(`delete from guests where phone_norm = '0548000001'`);

  // ---------- failures and retry ----------
  const g6 = await addGuest('משפחת נכשל', '0506666666');
  greenStatus = 500;
  r = await api('/api/admin/campaigns', { eventId, kind: 'invite', name: 'תקלה', body: INVITE, guestIds: [g6.id] });
  const campId = r.json.id;
  await tick();
  check('a provider outage keeps the message waiting instead of dropping it', (await sql(`select status from messages where campaign_id = $1`, [campId]))[0].status === 'pending');
  await tick(3);
  let [failed] = await sql(`select status, error, attempts from messages where campaign_id = $1`, [campId]);
  check('after three attempts the message is marked failed with the reason', failed.status === 'failed' && failed.attempts === 3 && !!failed.error, JSON.stringify(failed));
  check('a failed send does not mark the guest as invited', (await sql(`select invited_at from guests where id = $1`, [g6.id]))[0].invited_at === null);
  greenStatus = 200;
  const before = outbox.length;
  await api(`/api/admin/campaigns/${campId}`, { action: 'retry' }); await drain();
  check('retrying failed messages sends them once', outbox.length === before + 1 && (await sql(`select status from messages where campaign_id = $1`, [campId]))[0].status === 'sent');
  await tick(2);
  check('running the queue again sends nothing twice', outbox.length === before + 1);

  // two runs at the same moment must not double-send
  const many = []; for (let i = 0; i < 6; i++) many.push((await addGuest(`משפחה ${i}`, `05088800${10 + i}`)).id);
  await api('/api/admin/campaigns', { eventId, kind: 'invite', name: 'במקביל', body: INVITE, guestIds: many });
  const n0 = outbox.length;
  await Promise.all([tick(), tick(), tick()]); await drain();
  check('parallel runs of the queue never send a message twice', outbox.length === n0 + 6 && new Set(outbox.slice(n0).map((m) => m.to)).size === 6, `${outbox.length - n0}`);

  // ---------- reminders ----------
  const a = await addGuest('מגיעים א', '0531000001', { status: 'attending' }), b = await addGuest('מגיעים בלי תזכורת', '0531000002', { status: 'attending', reminders: false });
  const c = await addGuest('אולי', '0531000003', { status: 'maybe' }), d = await addGuest('לא מגיעים', '0531000004', { status: 'declined' });
  await addGuest('טרם השיבו', '0531000005'); await addGuest('מגיעים וביקשו לא לקבל', '0531000006', { status: 'attending', opted: true });
  const soon = () => new Date(Date.now() + 1500).toISOString();
  r = await api('/api/admin/campaigns', { eventId, kind: 'reminder', name: 'תזכורת 1', body: REMIND, scheduledAt: new Date(Date.now() - 60000).toISOString() });
  check('a reminder in the past is refused', r.status === 400);
  r = await api('/api/admin/campaigns', { eventId, kind: 'reminder', name: 'אחרי האירוע', body: REMIND, scheduledAt: new Date(Date.now() + 40 * 3600000).toISOString() });
  check('a reminder after the event starts is refused', r.status === 400);
  r = await api('/api/admin/campaigns', { eventId, kind: 'reminder', name: 'תזכורת 1', body: REMIND, scheduledAt: soon() });
  const rem1 = r.json.id; let n1 = outbox.length;
  await tick();
  check('a scheduled reminder sends nothing before its time', outbox.length === n1 && (await sql(`select count(*)::int n from messages where campaign_id = $1`, [rem1]))[0].n === 0);
  await sleep(1800); await drain();
  const got1 = outbox.slice(n1).map((m) => m.to);
  check('the reminder goes only to guests who confirmed and are eligible', got1.length === 1 && got1[0] === '972531000001@c.us', got1.join());
  check('the reminder text is filled, including navigation', outbox.at(-1).text.includes('היי מגיעים א') && outbox.at(-1).text.includes('waze.com'));
  await tick(2);
  check('the same reminder is not delivered twice', outbox.length === n1 + 1);

  // answers change between scheduling and sending
  r = await api('/api/admin/campaigns', { eventId, kind: 'reminder', name: 'תזכורת 2', body: REMIND, scheduledAt: soon() });
  await sql(`update guests set status = 'declined' where id = $1`, [a.id]);
  await sql(`update guests set status = 'attending', adults = 1 where id = $1`, [c.id]);
  n1 = outbox.length; await sleep(1800); await drain();
  const got2 = outbox.slice(n1).map((m) => m.to);
  check('a guest who cancelled is dropped and one who confirmed is added', got2.length === 1 && got2[0] === '972531000003@c.us', got2.join());

  // the answer changes after the message was queued but before it went out
  await sql(`update guests set status = 'attending', adults = 2 where id = $1`, [d.id]);
  greenStatus = 500;
  r = await api('/api/admin/campaigns', { eventId, kind: 'reminder', name: 'תזכורת 3', body: REMIND, scheduledAt: soon() });
  const rem3 = r.json.id; await sleep(1800); await tick();
  await sql(`update guests set status = 'declined' where id = $1`, [d.id]);
  greenStatus = 200; n1 = outbox.length; await drain();
  const [skip] = await sql(`select status, error from messages where campaign_id = $1 and guest_id = $2`, [rem3, d.id]);
  check('status is checked again right before sending', skip?.status === 'skipped' && !outbox.slice(n1).some((m) => m.to.includes('531000004')), JSON.stringify(skip));

  // pause and cancel
  r = await api('/api/admin/campaigns', { eventId, kind: 'reminder', name: 'תזכורת מושהית', body: REMIND, scheduledAt: soon() });
  await api(`/api/admin/campaigns/${r.json.id}`, { action: 'pause' }); n1 = outbox.length; await sleep(1800); await tick(2);
  check('a paused reminder does not fire', outbox.length === n1);
  await api(`/api/admin/campaigns/${r.json.id}`, { action: 'cancel' });
  check('a cancelled reminder stays cancelled', (await sql(`select status from campaigns where id = $1`, [r.json.id]))[0].status === 'cancelled');

  // the event has started
  await sql(`insert into campaigns (event_id, kind, name, body, site_url, status, scheduled_at) values ($1, 'reminder', 'מאוחר מדי', $2, 'https://invite.example', 'scheduled', now() - interval '1 minute')`, [eventId, REMIND]);
  const y = new Date(Date.now() - 3600000);
  await sql(`update events set event_date = $1, reception_time = $2 where id = $3`, [ymd(y), hm(y), eventId]);
  n1 = outbox.length; await tick(2);
  const [late] = await sql(`select status, note from campaigns where name = 'מאוחר מדי'`);
  check('no reminder is sent once the event has started', late.status === 'cancelled' && outbox.length === n1, JSON.stringify(late));

  // without credentials nothing is sent and nothing is lost: covered by the "waiting" flag
  check('guest messages went only to made-up numbers', outbox.filter((m) => !['972543049491@c.us', '972559991052@c.us'].includes(m.to)).every((m) => /^9725(0|2|3|4)\d{7}@c\.us$/.test(m.to)));
} catch (e) {
  check('run completed without an exception', false, e.stack ?? String(e));
} finally {
  app.kill();
  const bad = results.filter((x) => !x).length;
  console.log(`\n${results.length - bad}/${results.length} passed`);
  process.exit(bad ? 1 : 0);
}

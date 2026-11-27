/**
 * Runs the real migration inside an in-process Postgres (PGlite) with small stand-ins for the
 * Supabase-provided pieces (auth schema, roles, storage), then exercises the RSVP rules and RLS.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PRELUDE = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema extensions; create schema storage;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function extensions.gen_random_bytes(n int) returns bytea language sql volatile as $$ select decode(substr(md5(random()::text) || md5(random()::text), 1, n * 2), 'hex') $$;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
create publication supabase_realtime;
grant all on storage.objects to authenticated; grant usage on schema storage to authenticated;
grant usage on schema public, auth, extensions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

let db: PGlite;
const q = async <T = any>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const as = async <T>(role: 'anon' | 'authenticated', uid: string | null, fn: () => Promise<T>): Promise<T> => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
const rsvp = async (o: Partial<Record<'slug' | 'token' | 'name' | 'phone' | 'status' | 'notes' | 'prefs' | 'rl', string | null>> & { a?: number; c?: number; b?: number }) =>
  (await q(`select public.submit_rsvp($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) r`, [o.slug ?? 'kidar-brit', o.token ?? null, o.name ?? 'דנה לוי',
    o.phone ?? '050-1234567', o.status ?? 'attending', o.a ?? 2, o.c ?? 0, o.b ?? 0, o.notes ?? '', o.prefs ?? '', o.rl ?? null]))[0].r;

let eventId: string, otherEvent: string, owner: string, viewer: string, stranger: string;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(PRELUDE);
  await db.exec(readFileSync(path.join(__dirname, '../supabase/migrations/0001_init.sql'), 'utf8'));
  await db.exec(readFileSync(path.join(__dirname, '../supabase/seed_kidar.sql'), 'utf8'));
  eventId = (await q(`select id from events where slug='kidar-brit'`))[0].id;
  otherEvent = (await q(`insert into events (slug,name,published) values ('other-event','אחר',true) returning id`))[0].id;
  await q(`insert into admin_invites (email,event_id,role) values ('viewer@x.io',$1,'viewer'), ('stranger@x.io',$2,'owner')`, [eventId, otherEvent]);
  owner = (await q(`insert into auth.users (email) values ('Yogev_Email@example.com') returning id`))[0].id;
  viewer = (await q(`insert into auth.users (email) values ('viewer@x.io') returning id`))[0].id;
  stranger = (await q(`insert into auth.users (email) values ('stranger@x.io') returning id`))[0].id;
}, 60000);

describe('seed and sign-up', () => {
  it('creates the Kidar event unpublished with both notification recipients', async () => {
    const [e] = await q(`select * from events where id=$1`, [eventId]);
    expect(e).toMatchObject({ hosts: 'אביה ויוגב קידר', weekday_label: 'יום רביעי', hebrew_date: 'כ״ב בכסלו התשפ״ז', reception_time: '15:00', published: false });
    const [i] = await q(`select config from integrations where event_id=$1`, [eventId]);
    expect(i.config.recipients.map((r: any) => r.phone)).toEqual(['0543049491', '0559991052']);
  });
  it('refuses accounts that were not invited and wires invited ones to their event', async () => {
    await expect(q(`insert into auth.users (email) values ('nobody@x.io')`)).rejects.toThrow(/NOT_INVITED/);
    expect(await q(`select role from event_members where event_id=$1 and user_id=$2`, [eventId, owner])).toEqual([{ role: 'owner' }]);
    expect(await q(`select email from profiles where id=$1`, [owner])).toEqual([{ email: 'yogev_email@example.com' }]);
  });
});

describe('public RSVP', () => {
  it('is closed until the invitation is published', async () => {
    expect(await rsvp({})).toMatchObject({ ok: false, error: 'NOT_FOUND' });
    expect((await q(`select public.get_public_invitation('kidar-brit') r`))[0].r).toBeNull();
    await q(`update events set published=true where id=$1`, [eventId]);
  });
  it('saves a new answer, then updates the same family instead of duplicating it', async () => {
    const first = await rsvp({ a: 2, c: 1, b: 1, prefs: 'צמחוני' });
    expect(first).toMatchObject({ ok: true, created: true, changed: true, guest: { status: 'attending', adults: 2, children: 1, babies: 1 } });
    const again = await rsvp({ phone: '+972 50 123 4567', a: 3, c: 1 });
    expect(again).toMatchObject({ ok: true, created: false, changed: true, previous: { adults: 2, babies: 1 }, guest: { adults: 3, babies: 0 } });
    const same = await rsvp({ phone: '0501234567', a: 3, c: 1 });
    expect(same).toMatchObject({ ok: true, created: false, changed: false });
    expect(await q(`select count(*)::int n from guests where event_id=$1`, [eventId])).toEqual([{ n: 1 }]);
    const hist = await q(`select adults, source from rsvp_responses where event_id=$1 order by id`, [eventId]);
    expect(hist).toEqual([{ adults: 2, source: 'public' }, { adults: 3, source: 'public' }]);
  });
  it('supports all three answers and clears head-counts on decline', async () => {
    expect(await rsvp({ phone: '0521111111', name: 'משפחת אולי', status: 'maybe', a: 0 })).toMatchObject({ ok: true, guest: { status: 'maybe' } });
    expect(await rsvp({ phone: '0521111111', name: 'משפחת אולי', status: 'declined', a: 4, c: 2 })).toMatchObject({ ok: true, guest: { status: 'declined', adults: 0, children: 0 } });
  });
  it('rejects bad input', async () => {
    expect(await rsvp({ phone: '12' })).toMatchObject({ error: 'INVALID_PHONE' });
    expect(await rsvp({ name: 'x' })).toMatchObject({ error: 'INVALID_NAME' });
    expect(await rsvp({ status: 'pending' })).toMatchObject({ error: 'INVALID_STATUS' });
    expect(await rsvp({ phone: '0522222222', a: 0, c: 0 })).toMatchObject({ error: 'INVALID_COUNT' });
    expect(await rsvp({ phone: '0522222222', a: -1 })).toMatchObject({ error: 'INVALID_COUNT' });
    expect(await rsvp({ phone: '0522222222', a: 16 })).toMatchObject({ error: 'OVER_MAX', max: 15 });
    expect(await rsvp({ phone: '0522222222', notes: 'x'.repeat(501) })).toMatchObject({ error: 'TEXT_TOO_LONG' });
    expect(await rsvp({ token: 'ffffffffffffffffff' })).toMatchObject({ error: 'INVALID_LINK' });
  });
  it('treats SQL in text fields as plain text', async () => {
    const r = await rsvp({ phone: '0523333333', name: `Robert'); drop table guests;--`, notes: `<script>alert(1)</script>` });
    expect(r.ok).toBe(true);
    expect((await q(`select notes from guests where phone_norm='0523333333'`))[0].notes).toBe('<script>alert(1)</script>');
  });
  it('honours a personal link and its seat allocation', async () => {
    const [g] = await q(`insert into guests (event_id,family_name,allocated_seats) values ($1,'משפחת קידר הרחבה',4) returning invite_token`, [eventId]);
    expect(await rsvp({ token: g.invite_token, phone: '0531111111', a: 3, c: 2 })).toMatchObject({ error: 'OVER_ALLOCATION', allocated: 4 });
    expect(await rsvp({ token: g.invite_token, phone: '0501234567', a: 2 })).toMatchObject({ error: 'PHONE_IN_USE' });
    expect(await rsvp({ token: g.invite_token, phone: '0531111111', a: 2, c: 2, b: 1 })).toMatchObject({ ok: true, created: false, guest: { family_name: 'משפחת קידר הרחבה' } });
    const inv = (await q(`select public.get_public_invitation('kidar-brit',$1) r`, [g.invite_token]))[0].r;
    expect(inv.guest).toMatchObject({ family_name: 'משפחת קידר הרחבה', allocated_seats: 4, status: 'attending', adults: 2 });
  });
  it('never returns other guests, phones, tokens or integrations to the public', async () => {
    const text = JSON.stringify((await q(`select public.get_public_invitation('kidar-brit') r`))[0].r);
    for (const leak of ['0501234567', 'invite_token', 'recipients', '0543049491', 'דנה לוי', 'family_name']) expect(text).not.toContain(leak);
    expect(text).toContain('נולד לנו בן');
  });
  it('closes when the owners close it', async () => {
    await q(`update events set rsvp_settings = rsvp_settings || '{"open":false}' where id=$1`, [eventId]);
    expect(await rsvp({ phone: '0524444444' })).toMatchObject({ error: 'RSVP_CLOSED' });
    await q(`update events set rsvp_settings = rsvp_settings || '{"open":true}' where id=$1`, [eventId]);
  });
  it('rate-limits one visitor', async () => {
    let last: any;
    for (let i = 0; i < 13; i++) last = await rsvp({ phone: '0525555555', rl: 'visitor-a' });
    expect(last).toMatchObject({ ok: false, error: 'RATE_LIMITED' });
    expect(await rsvp({ phone: '0525555555', rl: 'visitor-b' })).toMatchObject({ ok: true });
  });
});

describe('tables', () => {
  it('never seats more people than a table holds', async () => {
    const [t] = await q(`insert into tables (event_id,name,capacity) values ($1,'שולחן 1',5) returning id`, [eventId]);
    const [a] = await q(`insert into guests (event_id,family_name,status,adults,children,babies) values ($1,'א','attending',2,1,2) returning id`, [eventId]);
    const [b] = await q(`insert into guests (event_id,family_name,status,adults) values ($1,'ב','attending',3) returning id`, [eventId]);
    const [c] = await q(`insert into guests (event_id,family_name,allocated_seats) values ($1,'ג',2) returning id`, [eventId]);
    await q(`update guests set table_id=$1 where id=$2`, [t.id, a.id]);          // 3 chairs, babies free
    await expect(q(`update guests set table_id=$1 where id=$2`, [t.id, b.id])).rejects.toThrow(/TABLE_FULL/);
    await q(`update guests set table_id=$1 where id=$2`, [t.id, c.id]);          // pending holds its 2 allocated chairs → 5/5
    await expect(q(`update tables set capacity=4 where id=$1`, [t.id])).rejects.toThrow(/TABLE_FULL/);
    await q(`update guests set status='declined' where id=$1`, [c.id]);          // frees 2
    await q(`update tables set capacity=4 where id=$1`, [t.id]);
    const [o] = await q(`insert into tables (event_id,name,capacity) values ($1,'זר',10) returning id`, [otherEvent]);
    await expect(q(`update guests set table_id=$1 where id=$2`, [o.id, b.id])).rejects.toThrow(/TABLE_NOT_FOUND/);
    await q(`delete from tables where id=$1`, [t.id]);
    expect((await q(`select table_id from guests where id=$1`, [a.id]))[0].table_id).toBeNull();
  });
});

describe('history and audit', () => {
  it('records status, head-count and arrival changes', async () => {
    const [x] = await q(`insert into guests (event_id,family_name) values ($1,'מעקב') returning id`, [eventId]);
    await q(`update guests set status='attending', adults=2 where id=$1`, [x.id]);
    await q(`update guests set adults=3 where id=$1`, [x.id]);
    await q(`update guests set arrived=true, arrived_count=3 where id=$1`, [x.id]);
    await q(`update guests set admin_notes='לא משנה היסטוריה' where id=$1`, [x.id]);
    const h = await q(`select status, adults, arrived from rsvp_responses where guest_id=$1 order by id`, [x.id]);
    expect(h).toEqual([{ status: 'attending', adults: 2, arrived: false }, { status: 'attending', adults: 3, arrived: false }, { status: 'attending', adults: 3, arrived: true }]);
    expect((await q(`select arrived_at, responded_at from guests where id=$1`, [x.id]))[0].arrived_at).not.toBeNull();
    expect((await q(`select count(*)::int n from audit_logs where entity_id=$1`, [x.id]))[0].n).toBeGreaterThanOrEqual(2);
  });
});

describe('access control', () => {
  it('gives anonymous visitors nothing', async () => {
    await as('anon', null, async () => {
      for (const t of ['guests', 'events', 'rsvp_responses', 'integrations', 'tables', 'admin_invites', 'audit_logs']) {
        await expect(q(`select * from ${t}`)).rejects.toThrow(/permission denied/);
      }
      await expect(q(`select public.submit_rsvp('kidar-brit',null,'אא','0501234567','attending',1,0,0,'','',null)`)).rejects.toThrow(/permission denied/);
      await expect(q(`select public.get_public_invitation('kidar-brit')`)).rejects.toThrow(/permission denied/);
      await expect(q(`insert into guests (event_id,family_name) values ('${eventId}','פורץ')`)).rejects.toThrow(/permission denied/);
    });
  });
  it('keeps events apart: a signed-in user of another event sees and changes nothing', async () => {
    await as('authenticated', stranger, async () => {
      expect(await q(`select * from guests where event_id=$1`, [eventId])).toEqual([]);
      expect(await q(`select * from events where id=$1`, [eventId])).toEqual([]);
      expect(await q(`select * from integrations`)).toEqual([]);
      expect(await q(`update guests set status='declined' where event_id=$1 returning id`, [eventId])).toEqual([]);
      expect(await q(`delete from guests where event_id=$1 returning id`, [eventId])).toEqual([]);
      await expect(q(`insert into guests (event_id,family_name) values ($1,'פורץ')`, [eventId])).rejects.toThrow(/row-level security/);
      await expect(q(`insert into event_members (event_id,user_id,role) values ($1,$2,'owner')`, [eventId, stranger])).rejects.toThrow(/row-level security/);
      await expect(q(`insert into admin_invites (email,event_id,role,invited_by) values ('me@x.io',$1,'owner',$2)`, [eventId, stranger])).rejects.toThrow(/row-level security/);
      await expect(q(`select public.duplicate_event($1,'stolen-copy','x')`, [eventId])).rejects.toThrow(/FORBIDDEN/);
      expect(await q(`select * from public.list_members($1)`, [eventId])).toEqual([]);
      await expect(q(`select public.submit_rsvp('kidar-brit',null,'אא','0501234567','attending',1,0,0,'','',null)`)).rejects.toThrow(/permission denied/);
    });
  });
  it('lets a viewer read but not write, and hides owner-only data from them', async () => {
    await as('authenticated', viewer, async () => {
      expect((await q(`select id from guests where event_id=$1`, [eventId])).length).toBeGreaterThan(3);
      expect(await q(`update guests set is_vip=true where event_id=$1 returning id`, [eventId])).toEqual([]);
      expect(await q(`update events set published=false where id=$1 returning id`, [eventId])).toEqual([]);
      expect(await q(`select * from integrations where event_id=$1`, [eventId])).toEqual([]);
      expect(await q(`update event_members set role='owner' where user_id=$1 returning role`, [viewer])).toEqual([]);
      await expect(q(`insert into tables (event_id,name,capacity) values ($1,'x',4)`, [eventId])).rejects.toThrow(/row-level security/);
    });
  });
  it('lets the owner manage guests, invite a teammate and duplicate the event', async () => {
    await as('authenticated', owner, async () => {
      const [gst] = await q(`insert into guests (event_id,family_name,allocated_seats) values ($1,'נוספו ידנית',3) returning id, source`, [eventId]);
      expect(gst.source).toBe('admin');
      expect((await q(`update guests set status='attending', adults=2 where id=$1 returning status`, [gst.id]))[0].status).toBe('attending');
      expect((await q(`select source, actor from rsvp_responses where guest_id=$1`, [gst.id]))[0]).toEqual({ source: 'admin', actor: owner });
      await q(`insert into admin_invites (email,event_id,role,invited_by) values ('editor@x.io',$1,'editor',$2)`, [eventId, owner]);
      expect((await q(`select * from public.list_members($1)`, [eventId])).length).toBe(2);
      const copy = (await q(`select public.duplicate_event($1,'kidar-copy','עותק') id`, [eventId]))[0].id;
      const [c] = await q(`select hosts, published from events where id=$1`, [copy]);
      expect(c).toEqual({ hosts: 'אביה ויוגב קידר', published: false });
      expect(await q(`select * from guests where event_id=$1`, [copy])).toEqual([]);
    });
  });
  it('limits uploads to members of the event folder', async () => {
    await as('authenticated', stranger, async () => {
      await expect(q(`insert into storage.objects (bucket_id,name) values ('event-media',$1)`, [`${eventId}/hero.jpg`])).rejects.toThrow(/row-level security/);
    });
    await as('authenticated', owner, async () => {
      await q(`insert into storage.objects (bucket_id,name) values ('event-media',$1)`, [`${eventId}/hero.jpg`]);
    });
  });
});

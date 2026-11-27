// Test double for Supabase: PostgREST-style REST, password sign-in and storage, backed by an
// in-process Postgres (PGlite) that runs the project's real migration, so RLS and RPCs are the real ones.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

export const SERVICE = 'service-key', ANON = 'anon-key', PASSWORD = 'correct-horse-battery';
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
grant usage on schema public, auth, extensions, storage to anon, authenticated, service_role;
grant all on storage.objects to authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;
const CMP = { lte: '<=', lt: '<', gte: '>=', gt: '>' };
const ident = (s) => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw Object.assign(new Error('bad identifier'), { status: 400 }); return s; };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub) => `${b64({ alg: 'none' })}.${b64({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.x`;

export async function startMock(port, root) {
  const db = new PGlite({ parsers: { 1082: (v) => v } }); // dates as plain YYYY-MM-DD, like PostgREST
  await db.exec(PRELUDE);
  await db.exec(readFileSync(`${root}/supabase/migrations/0001_init.sql`, 'utf8'));
  await db.exec(readFileSync(`${root}/supabase/seed_kidar.sql`, 'utf8'));
  await db.exec(readFileSync(`${root}/supabase/migrations/0002_whatsapp.sql`, 'utf8'));
  const files = new Map();
  let chain = Promise.resolve();
  const locked = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };

  async function run(token, fn) {
    return locked(async () => {
      let role = 'anon', sub = '';
      if (token === SERVICE) role = 'service_role';
      else if (token && token !== ANON) { try { sub = JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).sub; role = 'authenticated'; } catch { /* anon */ } }
      const safe = /^[0-9a-f-]{36}$/.test(sub) ? sub : '';
      await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${safe}', false);`);
      try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
    });
  }
  const userOf = async (id) => (await db.query(`select id, email from auth.users where id=$1`, [id])).rows[0];
  const session = (u) => ({ access_token: jwt(u.id), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r',
    user: { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });

  function where(params, start = 1) {
    const cond = [], vals = [];
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'columns', 'on_conflict'].includes(k)) continue;
      if (v.startsWith('eq.')) { vals.push(v.slice(3)); cond.push(`${ident(k)}::text = $${start + vals.length - 1}`); }
      else if (v === 'is.null') cond.push(`${ident(k)} is null`);
      else if (v.startsWith('in.(') && v.endsWith(')')) { vals.push(v.slice(4, -1).split(',').map((x) => x.replace(/^"|"$/g, ''))); cond.push(`${ident(k)}::text = any(cast($${start + vals.length - 1} as text[]))`); }
      else if (CMP[v.split('.')[0]]) { const [op, ...r] = v.split('.'); vals.push(r.join('.')); cond.push(`${ident(k)} ${CMP[op]} $${start + vals.length - 1}`); }
      else throw Object.assign(new Error(`unsupported filter ${v}`), { status: 400 });
    }
    return { sql: cond.length ? ` where ${cond.join(' and ')}` : '', vals };
  }
  const cols = (sel) => (!sel || sel === '*' ? '*' : sel.split(',').map(ident).join(','));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const chunks = []; for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '') || req.headers.apikey;
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': '*' });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };
    if (req.method === 'OPTIONS') return send(204, '');
    try {
      const p = url.pathname;
      if (p === '/auth/v1/token') {
        const b = JSON.parse(raw.toString() || '{}');
        if (url.searchParams.get('grant_type') === 'refresh_token') return send(400, { error: 'invalid_grant' });
        const u = (await db.query(`select id, email from auth.users where email=$1`, [String(b.email).toLowerCase()])).rows[0];
        if (!u || b.password !== PASSWORD) return send(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' });
        return send(200, session(u));
      }
      if (p === '/auth/v1/user') {
        let sub; try { sub = JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).sub; } catch { return send(401, { msg: 'no session' }); }
        const u = await userOf(sub);
        return u ? send(200, session(u).user) : send(401, { msg: 'no user' });
      }
      if (p === '/auth/v1/logout') return send(204, '');
      // the passcode lock signs in through the admin API: create the user, issue a link, verify it
      if (p === '/auth/v1/admin/users' && token === SERVICE) {
        const email = String(JSON.parse(raw.toString() || '{}').email).toLowerCase();
        const had = (await db.query(`select id, email from auth.users where email=$1`, [email])).rows[0];
        if (had) return send(422, { msg: 'A user with this email address has already been registered' });
        return send(200, session((await db.query(`insert into auth.users (email) values ($1) returning id, email`, [email])).rows[0]).user);
      }
      if (p === '/auth/v1/admin/generate_link' && token === SERVICE) {
        const u = (await db.query(`select id, email from auth.users where email=$1`, [String(JSON.parse(raw.toString() || '{}').email).toLowerCase()])).rows[0];
        return u ? send(200, { ...session(u).user, action_link: 'http://x', email_otp: '000000', hashed_token: u.id, verification_type: 'magiclink', redirect_to: '' }) : send(404, { msg: 'no user' });
      }
      if (p === '/auth/v1/verify') {
        const u = await userOf(JSON.parse(raw.toString() || '{}').token_hash);
        return u ? send(200, session(u)) : send(403, { msg: 'invalid token' });
      }
      if (p.startsWith('/storage/v1/object/public/')) {
        const f = files.get(p.slice('/storage/v1/object/public/'.length));
        return f ? send(200, f.body, f.type) : send(404, { message: 'not found' });
      }
      if (p.startsWith('/storage/v1/object/')) {
        const full = decodeURIComponent(p.slice('/storage/v1/object/'.length)); const [bucket, ...rest] = full.split('/'); const name = rest.join('/');
        if (req.method === 'DELETE') return send(200, []);
        await run(token, () => db.query(`insert into storage.objects (bucket_id, name) values ($1, $2)`, [bucket, name]));
        const type = req.headers['content-type'] ?? 'image/jpeg';
        let body = raw;
        if (type.startsWith('multipart/')) { const f = raw.indexOf('filename='); const i = raw.indexOf('\r\n\r\n', f) + 4; body = raw.subarray(i, raw.indexOf('\r\n--', i)); }
        files.set(full, { body, type: 'image/jpeg' });
        return send(200, { Key: full, Id: full });
      }
      if (p.startsWith('/rest/v1/rpc/')) {
        const fn = ident(p.slice('/rest/v1/rpc/'.length)); const args = JSON.parse(raw.toString() || '{}');
        const keys = Object.keys(args).map(ident);
        const r = await run(token, () => db.query(`select * from public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`, keys.map((k) => args[k])));
        return send(200, r.fields.length === 1 && r.fields[0].name === fn ? r.rows[0]?.[fn] ?? null : r.rows);
      }
      if (p.startsWith('/rest/v1/')) {
        const table = ident(p.slice('/rest/v1/'.length)); const q = url.searchParams;
        const one = (req.headers.accept ?? '').includes('vnd.pgrst.object');
        const ret = cols(q.get('select'));
        let rows;
        if (req.method === 'HEAD') {
          const w = where(q);
          const n = (await run(token, () => db.query(`select count(*)::int n from public.${table}${w.sql}`, w.vals))).rows[0].n;
          res.writeHead(200, { 'Content-Range': `*/${n}`, 'Access-Control-Expose-Headers': '*' }); return res.end();
        }
        if (req.method === 'GET') {
          const w = where(q);
          const order = q.get('order') ? ' order by ' + q.get('order').split(',').map((o) => { const [c, d] = o.split('.'); return `${ident(c)} ${d === 'desc' ? 'desc' : 'asc'}`; }).join(',') : '';
          const limit = q.get('limit') ? ` limit ${Number(q.get('limit'))}` : '';
          rows = (await run(token, () => db.query(`select ${ret} from public.${table}${w.sql}${order}${limit}`, w.vals))).rows;
        } else if (req.method === 'POST') {
          const body = JSON.parse(raw.toString()); const list = Array.isArray(body) ? body : [body]; rows = [];
          for (const item of list) {
            const k = Object.keys(item).filter((x) => item[x] !== undefined).map(ident);
            rows.push(...(await run(token, () => db.query(`insert into public.${table} (${k.join(',')}) select ${k.join(',')} from json_populate_record(null::public.${table}, $1)${(req.headers.prefer ?? '').includes('ignore-duplicates') ? ' on conflict do nothing' : ''} returning ${ret}`, [JSON.stringify(item)]))).rows);
          }
        } else if (req.method === 'PATCH') {
          const body = JSON.parse(raw.toString()); const k = Object.keys(body).map(ident); const w = where(q, 2);
          rows = (await run(token, () => db.query(`update public.${table} t set ${k.map((c) => `${c} = r.${c}`).join(', ')} from json_populate_record(null::public.${table}, $1) r${w.sql.replace(/(\w+)::text/g, 't.$1::text')} returning ${ret === '*' ? 't.*' : ret.split(',').map((c) => 't.' + c).join(',')}`, [JSON.stringify(body), ...w.vals]))).rows;
        } else if (req.method === 'DELETE') {
          const w = where(q);
          rows = (await run(token, () => db.query(`delete from public.${table}${w.sql} returning ${ret}`, w.vals))).rows;
        }
        if (one) return rows.length === 1 ? send(200, rows[0]) : send(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows` });
        return send(req.method === 'POST' ? 201 : 200, rows);
      }
      send(404, { message: 'not found' });
    } catch (e) {
      const msg = String(e.message ?? e);
      send(e.status ?? (msg.includes('permission denied') || msg.includes('row-level security') ? 403 : 400), { message: msg, code: e.code ?? (msg.includes('row-level security') ? '42501' : 'P0001') });
    }
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { db, server, sql: (text, params = []) => locked(() => db.query(text, params)).then((r) => r.rows) };
}

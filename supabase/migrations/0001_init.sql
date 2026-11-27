-- KIDAR RSVP 2.0 — schema, security, RSVP logic
create type public.guest_status as enum ('pending','attending','maybe','declined');
create type public.member_role as enum ('viewer','editor','owner');

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text not null,
  full_name text,
  created_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,60}$'),
  name text not null,
  hosts text, headline text, intro_text text, closing_text text,
  event_date date, weekday_label text, hebrew_date text,
  reception_time text, ceremony_time text, end_time text,
  venue_name text, address text, waze_url text, gmaps_url text,
  directions text, parking text, contact_phone text, extra_info text,
  hero_url text, hero_pos jsonb not null default '{"x":50,"y":50,"zoom":1,"ratio":"4/5"}',
  video_url text,
  design jsonb not null default '{}',
  rsvp_settings jsonb not null default '{"open":true,"max_party":15}',
  published boolean not null default false,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.event_members (
  event_id uuid not null references public.events on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role public.member_role not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index on public.event_members (user_id);

create table public.admin_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email)),
  event_id uuid references public.events on delete cascade,
  role public.member_role not null default 'viewer',
  invited_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create unique index admin_invites_uq on public.admin_invites (email, coalesce(event_id, '00000000-0000-0000-0000-000000000000'));

create table public.tables (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  name text not null,
  capacity int not null check (capacity between 1 and 200),
  pos_x numeric not null default 50, pos_y numeric not null default 50,
  shape text not null default 'round' check (shape in ('round','rect')),
  created_at timestamptz not null default now()
);
create index on public.tables (event_id);

create table public.guests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  family_name text not null check (char_length(family_name) between 1 and 120),
  contact_name text, phone text, phone_norm text,
  allocated_seats int check (allocated_seats between 0 and 100),
  adults int not null default 0 check (adults between 0 and 100),
  children int not null default 0 check (children between 0 and 100),
  babies int not null default 0 check (babies between 0 and 100),
  status public.guest_status not null default 'pending',
  responded_at timestamptz,
  arrived boolean not null default false,
  arrived_count int check (arrived_count between 0 and 300),
  arrived_at timestamptz,
  table_id uuid references public.tables on delete set null,
  notes text, preferences text, admin_notes text,
  is_vip boolean not null default false,
  group_name text,
  invite_token text not null unique default encode(extensions.gen_random_bytes(9), 'hex'),
  source text not null default 'admin' check (source in ('admin','public')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.guests (event_id);
create index on public.guests (table_id);
create unique index guests_event_phone_uq on public.guests (event_id, phone_norm) where phone_norm is not null;

create table public.rsvp_responses (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.events on delete cascade,
  guest_id uuid not null references public.guests on delete cascade,
  status public.guest_status not null,
  adults int not null, children int not null, babies int not null,
  arrived boolean not null default false,
  notes text, preferences text,
  source text not null,
  actor uuid,
  created_at timestamptz not null default now()
);
create index on public.rsvp_responses (event_id, created_at desc);
create index on public.rsvp_responses (guest_id);

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  kind text not null check (kind in ('gallery','venue')),
  url text not null, path text,
  caption text, sort int not null default 0,
  created_at timestamptz not null default now()
);
create index on public.media_assets (event_id);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  event_id uuid references public.events on delete cascade,
  actor uuid, action text not null, entity text not null, entity_id uuid,
  diff jsonb, created_at timestamptz not null default now()
);
create index on public.audit_logs (event_id, created_at desc);

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  type text not null check (type in ('webhook','greenapi')),
  name text not null,
  config jsonb not null default '{}',
  enabled boolean not null default true,
  last_status text, last_error text, last_sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.integrations (event_id);

create table public.notifications (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.events on delete cascade,
  integration_id uuid references public.integrations on delete set null,
  kind text not null, target text, status text not null, error text,
  created_at timestamptz not null default now()
);
create index on public.notifications (event_id, created_at desc);

create table public.rate_limits (
  key text not null, window_start timestamptz not null, count int not null default 1,
  primary key (key, window_start)
);

-- ---------- helpers ----------
create or replace function public.norm_phone(p text) returns text
language plpgsql immutable set search_path = '' as $$
declare d text;
begin
  if p is null then return null; end if;
  d := regexp_replace(p, '\D', '', 'g');
  if d like '972%' then d := '0' || substr(d, 4); end if;
  if char_length(d) < 9 or char_length(d) > 15 then return null; end if;
  return d;
end $$;

create or replace function public.guest_seats(g public.guests) returns int
language sql immutable set search_path = '' as $$
  select case g.status
    when 'declined' then 0
    when 'attending' then g.adults + g.children
    when 'maybe' then case when g.adults + g.children > 0 then g.adults + g.children else coalesce(g.allocated_seats, 0) end
    else coalesce(g.allocated_seats, 0) end
$$;

create or replace function public.is_member(eid uuid, min_role public.member_role default 'viewer') returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.event_members m
                 where m.event_id = eid and m.user_id = (select auth.uid()) and m.role >= min_role)
$$;
revoke all on function public.is_member(uuid, public.member_role) from public, anon;
grant execute on function public.is_member(uuid, public.member_role) to authenticated, service_role;

-- ---------- auth: invite-only signup ----------
create or replace function public.check_invited() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.admin_invites i where i.email = lower(new.email)) then
    raise exception 'NOT_INVITED';
  end if;
  return new;
end $$;
create trigger rsvp_check_invited before insert on auth.users
  for each row execute function public.check_invited();

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, lower(new.email), new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  insert into public.event_members (event_id, user_id, role)
  select i.event_id, new.id, i.role from public.admin_invites i
  where i.email = lower(new.email) and i.event_id is not null
  on conflict do nothing;
  return new;
end $$;
create trigger rsvp_handle_new_user after insert on auth.users
  for each row execute function public.handle_new_user();

-- inviting an email that already has an account grants access immediately
create or replace function public.apply_invite() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.event_id is not null then
    insert into public.event_members (event_id, user_id, role)
    select new.event_id, p.id, new.role from public.profiles p where p.email = new.email
    on conflict (event_id, user_id) do update set role = excluded.role;
  end if;
  return new;
end $$;
create trigger admin_invites_apply after insert on public.admin_invites
  for each row execute function public.apply_invite();

create or replace function public.event_owner_membership() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.created_by is not null then
    insert into public.event_members (event_id, user_id, role) values (new.id, new.created_by, 'owner')
    on conflict do nothing;
  end if;
  return new;
end $$;
create trigger events_owner after insert on public.events
  for each row execute function public.event_owner_membership();

-- ---------- guests: normalisation, capacity, history ----------
create or replace function public.guests_before() returns trigger
language plpgsql set search_path = '' as $$
declare cap int; used int;
begin
  new.phone_norm := public.norm_phone(new.phone);
  new.updated_at := now();
  if new.status = 'declined' then new.adults := 0; new.children := 0; new.babies := 0; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'pending' and new.responded_at is null then new.responded_at := now(); end if;
  else
    new.event_id := old.event_id;
    new.invite_token := old.invite_token;
    if new.status is distinct from old.status or new.adults <> old.adults
       or new.children <> old.children or new.babies <> old.babies then
      new.responded_at := case when new.status = 'pending' then null else now() end;
    end if;
    if new.arrived and not old.arrived then new.arrived_at := now(); end if;
    if not new.arrived then new.arrived_at := null; new.arrived_count := null; end if;
  end if;
  if new.table_id is not null and (tg_op = 'INSERT' or new.table_id is distinct from old.table_id) then
    select t.capacity into cap from public.tables t
      where t.id = new.table_id and t.event_id = new.event_id for update;
    if cap is null then raise exception 'TABLE_NOT_FOUND'; end if;
    select coalesce(sum(public.guest_seats(g)), 0) into used from public.guests g
      where g.table_id = new.table_id and g.id <> new.id;
    if used + public.guest_seats(new) > cap then raise exception 'TABLE_FULL'; end if;
  end if;
  return new;
end $$;
create trigger guests_before before insert or update on public.guests
  for each row execute function public.guests_before();

create or replace function public.guests_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare src text := coalesce(nullif(current_setting('app.rsvp_source', true), ''),
                             case when (select auth.uid()) is null then 'system' else 'admin' end);
begin
  if tg_op = 'DELETE' then
    insert into public.audit_logs (event_id, actor, action, entity, entity_id, diff)
    select old.event_id, (select auth.uid()), 'delete', 'guest', old.id, jsonb_build_object('family_name', old.family_name)
    where exists (select 1 from public.events e where e.id = old.event_id);
    return old;
  end if;
  if tg_op = 'INSERT' then
    insert into public.audit_logs (event_id, actor, action, entity, entity_id, diff)
    values (new.event_id, (select auth.uid()), 'create', 'guest', new.id,
            jsonb_build_object('family_name', new.family_name, 'source', src));
  end if;
  if (tg_op = 'INSERT' and new.status <> 'pending')
     or (tg_op = 'UPDATE' and (new.status is distinct from old.status or new.adults <> old.adults
         or new.children <> old.children or new.babies <> old.babies or new.arrived <> old.arrived)) then
    insert into public.rsvp_responses (event_id, guest_id, status, adults, children, babies, arrived, notes, preferences, source, actor)
    values (new.event_id, new.id, new.status, new.adults, new.children, new.babies, new.arrived, new.notes, new.preferences, src, (select auth.uid()));
  end if;
  if tg_op = 'UPDATE' and (new.table_id is distinct from old.table_id or new.is_vip <> old.is_vip
       or new.allocated_seats is distinct from old.allocated_seats or new.status <> old.status) then
    insert into public.audit_logs (event_id, actor, action, entity, entity_id, diff)
    values (new.event_id, (select auth.uid()), 'update', 'guest', new.id, jsonb_build_object(
      'status', jsonb_build_array(old.status, new.status), 'table', jsonb_build_array(old.table_id, new.table_id),
      'allocated', jsonb_build_array(old.allocated_seats, new.allocated_seats), 'source', src));
  end if;
  return new;
end $$;
create trigger guests_after after insert or update or delete on public.guests
  for each row execute function public.guests_after();

create or replace function public.audit_generic() returns trigger
language plpgsql security definer set search_path = '' as $$
declare j jsonb := coalesce(to_jsonb(new), to_jsonb(old)); eid uuid; rid uuid;
begin
  if tg_table_name = 'events' then
    new.updated_at := now(); eid := new.id; rid := new.id;
  else
    eid := (j ->> 'event_id')::uuid; rid := coalesce(j ->> 'id', j ->> 'user_id')::uuid;
  end if;
  insert into public.audit_logs (event_id, actor, action, entity, entity_id)
  select eid, (select auth.uid()), lower(tg_op), tg_table_name, rid
  where exists (select 1 from public.events e where e.id = eid);
  return coalesce(new, old);
end $$;
create trigger events_audit before update on public.events for each row execute function public.audit_generic();
create trigger tables_audit after insert or update or delete on public.tables for each row execute function public.audit_generic();
create trigger integrations_audit after insert or update or delete on public.integrations for each row execute function public.audit_generic();
create trigger members_audit after insert or update or delete on public.event_members for each row execute function public.audit_generic();

-- shrinking a table below its seated head-count is refused
create or replace function public.tables_before_update() returns trigger
language plpgsql set search_path = '' as $$
declare used int;
begin
  if new.capacity < old.capacity then
    select coalesce(sum(public.guest_seats(g)), 0) into used from public.guests g where g.table_id = new.id;
    if used > new.capacity then raise exception 'TABLE_FULL'; end if;
  end if;
  return new;
end $$;
create trigger tables_before_update before update on public.tables
  for each row execute function public.tables_before_update();

-- ---------- RLS ----------
alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.event_members enable row level security;
alter table public.admin_invites enable row level security;
alter table public.tables enable row level security;
alter table public.guests enable row level security;
alter table public.rsvp_responses enable row level security;
alter table public.media_assets enable row level security;
alter table public.audit_logs enable row level security;
alter table public.integrations enable row level security;
alter table public.notifications enable row level security;
alter table public.rate_limits enable row level security;

create policy profiles_self on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_self_upd on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy events_sel on public.events for select to authenticated using (public.is_member(id) or created_by = (select auth.uid()));
create policy events_ins on public.events for insert to authenticated with check (created_by = (select auth.uid()));
create policy events_upd on public.events for update to authenticated using (public.is_member(id, 'editor')) with check (public.is_member(id, 'editor'));
create policy events_del on public.events for delete to authenticated using (public.is_member(id, 'owner'));

create policy members_sel on public.event_members for select to authenticated using (public.is_member(event_id));
create policy members_upd on public.event_members for update to authenticated using (public.is_member(event_id, 'owner')) with check (public.is_member(event_id, 'owner'));
create policy members_del on public.event_members for delete to authenticated using (public.is_member(event_id, 'owner'));

create policy invites_sel on public.admin_invites for select to authenticated using (event_id is not null and public.is_member(event_id, 'owner'));
create policy invites_ins on public.admin_invites for insert to authenticated with check (event_id is not null and public.is_member(event_id, 'owner') and invited_by = (select auth.uid()));
create policy invites_del on public.admin_invites for delete to authenticated using (event_id is not null and public.is_member(event_id, 'owner'));

create policy tables_sel on public.tables for select to authenticated using (public.is_member(event_id));
create policy tables_ins on public.tables for insert to authenticated with check (public.is_member(event_id, 'editor'));
create policy tables_upd on public.tables for update to authenticated using (public.is_member(event_id, 'editor')) with check (public.is_member(event_id, 'editor'));
create policy tables_del on public.tables for delete to authenticated using (public.is_member(event_id, 'editor'));

create policy guests_sel on public.guests for select to authenticated using (public.is_member(event_id));
create policy guests_ins on public.guests for insert to authenticated with check (public.is_member(event_id, 'editor'));
create policy guests_upd on public.guests for update to authenticated using (public.is_member(event_id, 'editor')) with check (public.is_member(event_id, 'editor'));
create policy guests_del on public.guests for delete to authenticated using (public.is_member(event_id, 'editor'));

create policy media_sel on public.media_assets for select to authenticated using (public.is_member(event_id));
create policy media_ins on public.media_assets for insert to authenticated with check (public.is_member(event_id, 'editor'));
create policy media_upd on public.media_assets for update to authenticated using (public.is_member(event_id, 'editor')) with check (public.is_member(event_id, 'editor'));
create policy media_del on public.media_assets for delete to authenticated using (public.is_member(event_id, 'editor'));

create policy integ_sel on public.integrations for select to authenticated using (public.is_member(event_id, 'owner'));
create policy integ_ins on public.integrations for insert to authenticated with check (public.is_member(event_id, 'owner'));
create policy integ_upd on public.integrations for update to authenticated using (public.is_member(event_id, 'owner')) with check (public.is_member(event_id, 'owner'));
create policy integ_del on public.integrations for delete to authenticated using (public.is_member(event_id, 'owner'));

create policy responses_sel on public.rsvp_responses for select to authenticated using (public.is_member(event_id));
create policy audit_sel on public.audit_logs for select to authenticated using (public.is_member(event_id, 'owner'));
create policy notif_sel on public.notifications for select to authenticated using (public.is_member(event_id, 'owner'));
-- rate_limits: no policies — service role only.

revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

-- ---------- public RPCs (service role only; called from the Next.js server) ----------
create or replace function public.get_public_invitation(p_slug text, p_token text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e public.events; g public.guests; res jsonb;
begin
  select * into e from public.events where slug = p_slug and published;
  if not found then return null; end if;
  res := jsonb_build_object(
    'id', e.id, 'slug', e.slug, 'name', e.name, 'hosts', e.hosts, 'headline', e.headline,
    'intro_text', e.intro_text, 'closing_text', e.closing_text,
    'event_date', e.event_date, 'weekday_label', e.weekday_label, 'hebrew_date', e.hebrew_date,
    'reception_time', e.reception_time, 'ceremony_time', e.ceremony_time, 'end_time', e.end_time,
    'venue_name', e.venue_name, 'address', e.address, 'waze_url', e.waze_url, 'gmaps_url', e.gmaps_url,
    'directions', e.directions, 'parking', e.parking, 'contact_phone', e.contact_phone, 'extra_info', e.extra_info,
    'hero_url', e.hero_url, 'hero_pos', e.hero_pos, 'video_url', e.video_url,
    'design', e.design, 'rsvp_settings', e.rsvp_settings,
    'media', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'url', m.url, 'caption', m.caption)
                       order by m.sort, m.created_at) from public.media_assets m where m.event_id = e.id), '[]'::jsonb));
  if p_token is not null and p_token <> '' then
    select * into g from public.guests where event_id = e.id and invite_token = p_token;
    if found then
      res := res || jsonb_build_object('guest', jsonb_build_object(
        'family_name', g.family_name, 'contact_name', g.contact_name, 'allocated_seats', g.allocated_seats,
        'status', g.status, 'adults', g.adults, 'children', g.children, 'babies', g.babies,
        'notes', g.notes, 'preferences', g.preferences));
    end if;
  end if;
  return res;
end $$;

create or replace function public.submit_rsvp(
  p_slug text, p_token text, p_name text, p_phone text, p_status text,
  p_adults int, p_children int, p_babies int, p_notes text, p_preferences text, p_rl_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e public.events; g public.guests; prev public.guests;
  st public.guest_status; ph text; nm text; was_new boolean := false;
  win timestamptz := date_trunc('hour', now()) + floor(extract(minute from now()) / 10) * interval '10 minutes';
  hits int; max_party int;
begin
  if p_rl_key is not null then
    insert into public.rate_limits (key, window_start) values (p_rl_key, win)
      on conflict (key, window_start) do update set count = public.rate_limits.count + 1
      returning count into hits;
    delete from public.rate_limits where window_start < now() - interval '1 day';
    if hits > 12 then return jsonb_build_object('ok', false, 'error', 'RATE_LIMITED'); end if;
  end if;

  select * into e from public.events where slug = p_slug and published;
  if not found then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  if coalesce((e.rsvp_settings ->> 'open')::boolean, true) is false then
    return jsonb_build_object('ok', false, 'error', 'RSVP_CLOSED');
  end if;
  if p_status not in ('attending','maybe','declined') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_STATUS');
  end if;
  st := p_status::public.guest_status;
  nm := btrim(coalesce(p_name, ''));
  ph := public.norm_phone(p_phone);
  if char_length(nm) < 2 or char_length(nm) > 80 then return jsonb_build_object('ok', false, 'error', 'INVALID_NAME'); end if;
  if ph is null then return jsonb_build_object('ok', false, 'error', 'INVALID_PHONE'); end if;
  p_adults := coalesce(p_adults, 0); p_children := coalesce(p_children, 0); p_babies := coalesce(p_babies, 0);
  if st = 'declined' then p_adults := 0; p_children := 0; p_babies := 0; end if;
  if least(p_adults, p_children, p_babies) < 0 or greatest(p_adults, p_children, p_babies) > 50 then return jsonb_build_object('ok', false, 'error', 'INVALID_COUNT'); end if;
  if st = 'attending' and p_adults + p_children < 1 then return jsonb_build_object('ok', false, 'error', 'INVALID_COUNT'); end if;
  if char_length(coalesce(p_notes, '')) > 500 or char_length(coalesce(p_preferences, '')) > 500 then
    return jsonb_build_object('ok', false, 'error', 'TEXT_TOO_LONG');
  end if;
  max_party := coalesce((e.rsvp_settings ->> 'max_party')::int, 15);

  if p_token is not null and p_token <> '' then
    select * into g from public.guests where event_id = e.id and invite_token = p_token for update;
    if not found then return jsonb_build_object('ok', false, 'error', 'INVALID_LINK'); end if;
    if exists (select 1 from public.guests o where o.event_id = e.id and o.phone_norm = ph and o.id <> g.id) then
      return jsonb_build_object('ok', false, 'error', 'PHONE_IN_USE');
    end if;
  else
    select * into g from public.guests where event_id = e.id and phone_norm = ph for update;
  end if;

  if g.id is not null and g.allocated_seats is not null then
    if p_adults + p_children > g.allocated_seats then
      return jsonb_build_object('ok', false, 'error', 'OVER_ALLOCATION', 'allocated', g.allocated_seats);
    end if;
  elsif p_adults + p_children + p_babies > max_party then
    return jsonb_build_object('ok', false, 'error', 'OVER_MAX', 'max', max_party);
  end if;

  perform set_config('app.rsvp_source', 'public', true);
  if g.id is null then
    was_new := true;
    insert into public.guests (event_id, family_name, contact_name, phone, status, adults, children, babies, notes, preferences, source)
    values (e.id, nm, nm, ph, st, p_adults, p_children, p_babies, nullif(btrim(p_notes), ''), nullif(btrim(p_preferences), ''), 'public')
    returning * into g;
  else
    prev := g;
    update public.guests set contact_name = nm, phone = ph, status = st,
      adults = p_adults, children = p_children, babies = p_babies,
      notes = nullif(btrim(p_notes), ''), preferences = nullif(btrim(p_preferences), '')
    where id = g.id returning * into g;
  end if;

  return jsonb_build_object('ok', true, 'created', was_new,
    'changed', was_new or prev.status <> g.status or prev.adults <> g.adults or prev.children <> g.children or prev.babies <> g.babies,
    'event', jsonb_build_object('id', e.id, 'name', e.name),
    'guest', jsonb_build_object('id', g.id, 'family_name', g.family_name, 'contact_name', g.contact_name, 'phone', g.phone,
      'status', g.status, 'adults', g.adults, 'children', g.children, 'babies', g.babies, 'notes', g.notes, 'preferences', g.preferences),
    'previous', case when was_new then null else jsonb_build_object('status', prev.status, 'adults', prev.adults, 'children', prev.children, 'babies', prev.babies) end);
end $$;

revoke all on function public.get_public_invitation(text, text) from public, anon, authenticated;
revoke all on function public.submit_rsvp(text, text, text, text, text, int, int, int, text, text, text) from public, anon, authenticated;
grant execute on function public.get_public_invitation(text, text) to service_role;
grant execute on function public.submit_rsvp(text, text, text, text, text, int, int, int, text, text, text) to service_role;

-- ---------- member-facing RPCs ----------
create or replace function public.list_members(p_event uuid) returns table (user_id uuid, email text, full_name text, role public.member_role)
language sql stable security definer set search_path = '' as $$
  select m.user_id, p.email, p.full_name, m.role from public.event_members m
  join public.profiles p on p.id = m.user_id
  where m.event_id = p_event and public.is_member(p_event)
$$;
revoke all on function public.list_members(uuid) from public, anon;
grant execute on function public.list_members(uuid) to authenticated;

create or replace function public.duplicate_event(p_event uuid, p_slug text, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare nid uuid;
begin
  if not public.is_member(p_event, 'owner') then raise exception 'FORBIDDEN'; end if;
  insert into public.events (slug, name, hosts, headline, intro_text, closing_text, event_date, weekday_label, hebrew_date,
    reception_time, ceremony_time, end_time, venue_name, address, waze_url, gmaps_url, directions, parking, contact_phone,
    extra_info, hero_url, hero_pos, video_url, design, rsvp_settings, published, created_by)
  select p_slug, p_name, hosts, headline, intro_text, closing_text, event_date, weekday_label, hebrew_date,
    reception_time, ceremony_time, end_time, venue_name, address, waze_url, gmaps_url, directions, parking, contact_phone,
    extra_info, hero_url, hero_pos, video_url, design, rsvp_settings, false, (select auth.uid())
  from public.events where id = p_event returning id into nid;
  insert into public.media_assets (event_id, kind, url, path, caption, sort)
  select nid, kind, url, null, caption, sort from public.media_assets where event_id = p_event;
  return nid;
end $$;
revoke all on function public.duplicate_event(uuid, text, text) from public, anon;
grant execute on function public.duplicate_event(uuid, text, text) to authenticated;

revoke all on function public.check_invited() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.apply_invite() from public, anon, authenticated;
revoke all on function public.event_owner_membership() from public, anon, authenticated;
revoke all on function public.guests_after() from public, anon, authenticated;
revoke all on function public.audit_generic() from public, anon, authenticated;

-- ---------- storage & realtime ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-media', 'event-media', true, 10485760, array['image/jpeg','image/png','image/webp','image/avif','video/mp4'])
on conflict (id) do nothing;

create policy "event media insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'event-media' and public.is_member(((storage.foldername(name))[1])::uuid, 'editor'));
create policy "event media update" on storage.objects for update to authenticated
  using (bucket_id = 'event-media' and public.is_member(((storage.foldername(name))[1])::uuid, 'editor'));
create policy "event media delete" on storage.objects for delete to authenticated
  using (bucket_id = 'event-media' and public.is_member(((storage.foldername(name))[1])::uuid, 'editor'));

alter publication supabase_realtime add table public.guests, public.tables;

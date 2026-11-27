-- KIDAR RSVP 2.0 — WhatsApp invitations, message templates and automatic reminders.
-- Run once, after 0001_init.sql. Safe to run again.

alter table public.guests
  add column if not exists invited_at timestamptz,
  add column if not exists reminders_enabled boolean not null default true,
  add column if not exists opted_out boolean not null default false;

create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  kind text not null check (kind in ('invite','reminder')),
  name text not null check (char_length(name) between 1 and 80),
  body text not null check (char_length(body) between 1 and 2000),
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists message_templates_event on public.message_templates (event_id);

-- One send-out. An invitation campaign has its recipients fixed when it is created;
-- a reminder is scheduled, and its recipients are chosen only when it comes due.
create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  kind text not null check (kind in ('invite','reminder')),
  name text not null check (char_length(name) between 1 and 120),
  template_name text,
  body text not null check (char_length(body) between 1 and 2000),
  site_url text not null,
  status text not null default 'sending' check (status in ('scheduled','sending','paused','done','cancelled')),
  note text,
  scheduled_at timestamptz,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists campaigns_event on public.campaigns (event_id, created_at desc);

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.events on delete cascade,
  campaign_id uuid not null references public.campaigns on delete cascade,
  guest_id uuid references public.guests on delete set null,
  name text,
  phone text not null,
  body text,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','skipped')),
  error text,
  provider_id text,
  attempts int not null default 0,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
-- a phone gets one message per campaign, however many times the request is repeated
create unique index if not exists messages_once on public.messages (campaign_id, phone);
create index if not exists messages_queue on public.messages (status, id);
create index if not exists messages_guest on public.messages (guest_id);

alter table public.message_templates enable row level security;
alter table public.campaigns enable row level security;
alter table public.messages enable row level security;

drop policy if exists templates_sel on public.message_templates;
drop policy if exists templates_ins on public.message_templates;
drop policy if exists templates_upd on public.message_templates;
drop policy if exists templates_del on public.message_templates;
create policy templates_sel on public.message_templates for select to authenticated using (public.is_member(event_id));
create policy templates_ins on public.message_templates for insert to authenticated with check (public.is_member(event_id, 'editor'));
create policy templates_upd on public.message_templates for update to authenticated using (public.is_member(event_id, 'editor')) with check (public.is_member(event_id, 'editor'));
create policy templates_del on public.message_templates for delete to authenticated using (public.is_member(event_id, 'editor'));

-- campaigns and messages are written only by the server (service role), after it checked the caller's role
drop policy if exists campaigns_sel on public.campaigns;
drop policy if exists messages_sel on public.messages;
create policy campaigns_sel on public.campaigns for select to authenticated using (public.is_member(event_id));
create policy messages_sel on public.messages for select to authenticated using (public.is_member(event_id));
revoke all on public.message_templates, public.campaigns, public.messages from anon;
revoke insert, update, delete on public.campaigns, public.messages from authenticated;

-- Hands out the next messages to send. `skip locked` lets two runs work side by side without sending one message twice.
create or replace function public.claim_messages(p_limit int) returns setof public.messages
language sql security definer set search_path = '' as $$
  update public.messages m set status = 'sending', attempts = m.attempts + 1, claimed_at = now()
  where m.id in (
    select x.id from public.messages x join public.campaigns c on c.id = x.campaign_id
    where x.status = 'pending' and c.status = 'sending'
    order by x.id limit greatest(1, least(p_limit, 20)) for update of x skip locked)
  returning m.*
$$;
revoke all on function public.claim_messages(int) from public, anon, authenticated;
grant execute on function public.claim_messages(int) to service_role;

-- KIDAR RSVP 2.0 — short personal links and invitation analytics.
-- Run once, after 0002_whatsapp.sql. Safe to run again.

-- A short code per guest, for links like /kidar-brit/Ab3xK9pQ. Random, so a name or a phone can never be guessed from it.
alter table public.guests add column if not exists link_code text;
update public.guests set link_code = translate(encode(extensions.gen_random_bytes(6), 'base64'), '+/', 'kd') where link_code is null;
alter table public.guests alter column link_code set default translate(encode(extensions.gen_random_bytes(6), 'base64'), '+/', 'kd');
create unique index if not exists guests_link_code_uq on public.guests (event_id, link_code);

-- What guests did with the invitation: opened it, started to answer. Recorded by the page itself, so link previews and crawlers are not counted.
create table if not exists public.invitation_events (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.events on delete cascade,
  guest_id uuid references public.guests on delete cascade,
  kind text not null check (kind in ('visit','rsvp_start')),
  visitor text,
  created_at timestamptz not null default now()
);
create index if not exists invitation_events_event on public.invitation_events (event_id, kind);
create index if not exists invitation_events_guest on public.invitation_events (guest_id);
alter table public.invitation_events enable row level security;
drop policy if exists invitation_events_sel on public.invitation_events;
create policy invitation_events_sel on public.invitation_events for select to authenticated using (public.is_member(event_id));
revoke all on public.invitation_events from anon;
revoke insert, update, delete on public.invitation_events from authenticated;

create or replace function public.track_invitation(p_slug text, p_token text, p_kind text, p_visitor text) returns void
language plpgsql security definer set search_path = '' as $$
declare e_id uuid; g_id uuid;
begin
  if p_kind not in ('visit','rsvp_start') then return; end if;
  select id into e_id from public.events where slug = p_slug and published;
  if e_id is null then return; end if;
  if p_token is not null and p_token <> '' then
    select id into g_id from public.guests where event_id = e_id and (invite_token = p_token or link_code = p_token);
  end if;
  insert into public.invitation_events (event_id, guest_id, kind, visitor) values (e_id, g_id, p_kind, left(coalesce(p_visitor, ''), 40));
end $$;
revoke all on function public.track_invitation(text, text, text, text) from public, anon, authenticated;
grant execute on function public.track_invitation(text, text, text, text) to service_role;

-- The invitation and the RSVP accept the short code as well as the long token, so links already sent keep working.
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
    select * into g from public.guests where event_id = e.id and (invite_token = p_token or link_code = p_token);
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
    select * into g from public.guests where event_id = e.id and (invite_token = p_token or link_code = p_token) for update;
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

-- KIDAR RSVP 2.0 — the WhatsApp (Green API) connection, entered from the admin screen instead of the hosting settings.
-- Run once, after 0003_links_analytics.sql. Safe to run again.

-- One row per event. No policy at all: only the server reads or writes it, never a browser, not even the owner's.
create table if not exists public.event_secrets (
  event_id uuid primary key references public.events on delete cascade,
  green_instance text,
  green_token text,
  green_url text,
  updated_at timestamptz not null default now()
);
alter table public.event_secrets enable row level security;
revoke all on public.event_secrets from anon, authenticated;

-- KIDAR RSVP 2.0 — a guest may answer without a phone number.
-- Run once, after 0004_green_api.sql. Safe to run again.
-- With a number, an answer still finds the family by it. Without one, an answer from a personal link updates that family
-- and keeps the number it already has; an answer from the general link is saved as a new family, and the page keeps
-- that family's own link code on the guest's phone so a later change updates the same row.

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
  -- a phone number is welcome but not required; one that was typed must be a real one
  if ph is null and btrim(coalesce(p_phone, '')) <> '' then return jsonb_build_object('ok', false, 'error', 'INVALID_PHONE'); end if;
  p_adults := coalesce(p_adults, 0); p_children := coalesce(p_children, 0); p_babies := coalesce(p_babies, 0);
  if st = 'declined' then p_adults := 0; p_children := 0; p_babies := 0; end if;
  if least(p_adults, p_children, p_babies) < 0 or greatest(p_adults, p_children, p_babies) > 50 then return jsonb_build_object('ok', false, 'error', 'INVALID_COUNT'); end if;
  if st = 'attending' and p_adults + p_children < 1 then return jsonb_build_object('ok', false, 'error', 'INVALID_COUNT'); end if;
  if char_length(coalesce(p_notes, '')) > 500 or char_length(coalesce(p_preferences, '')) > 500 then
    return jsonb_build_object('ok', false, 'error', 'TEXT_TOO_LONG');
  end if;
  max_party := coalesce((e.rsvp_settings ->> 'max_party')::int, 15);

  if p_token is not null and p_token <> '' then
    select * into g from public.guests where event_id = e.id and (invite_token = p_token or link_code = p_token) for update;
    if not found then return jsonb_build_object('ok', false, 'error', 'INVALID_LINK'); end if;
    if ph is not null and exists (select 1 from public.guests o where o.event_id = e.id and o.phone_norm = ph and o.id <> g.id) then
      return jsonb_build_object('ok', false, 'error', 'PHONE_IN_USE');
    end if;
  elsif ph is not null then
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
    update public.guests set contact_name = nm, phone = coalesce(ph, phone), status = st,
      adults = p_adults, children = p_children, babies = p_babies,
      notes = nullif(btrim(p_notes), ''), preferences = nullif(btrim(p_preferences), '')
    where id = g.id returning * into g;
  end if;

  return jsonb_build_object('ok', true, 'created', was_new,
    'changed', was_new or prev.status <> g.status or prev.adults <> g.adults or prev.children <> g.children or prev.babies <> g.babies,
    'event', jsonb_build_object('id', e.id, 'name', e.name),
    'guest', jsonb_build_object('id', g.id, 'link_code', g.link_code, 'family_name', g.family_name, 'contact_name', g.contact_name, 'phone', g.phone,
      'status', g.status, 'adults', g.adults, 'children', g.children, 'babies', g.babies, 'notes', g.notes, 'preferences', g.preferences),
    'previous', case when was_new then null else jsonb_build_object('status', prev.status, 'adults', prev.adults, 'children', prev.children, 'babies', prev.babies) end);
end $$;

-- KIDAR RSVP 2.0 — the clock behind automatic reminders and queued invitations.
-- Run once, after 0002_whatsapp.sql. Every minute the database calls the site, which sends what is queued and due.
-- Replace the address if the site moves to another domain, then run again: the job is updated in place.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'kidar-rsvp-tick',
  '* * * * *',
  $$ select net.http_post(url := 'https://kidar-rsvp-crzn.vercel.app/api/cron/tick', body := '{}'::jsonb, timeout_milliseconds := 25000) $$
);

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

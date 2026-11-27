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

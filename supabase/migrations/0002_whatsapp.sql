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

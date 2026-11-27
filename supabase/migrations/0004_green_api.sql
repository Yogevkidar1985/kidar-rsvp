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

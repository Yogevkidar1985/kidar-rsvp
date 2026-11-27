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

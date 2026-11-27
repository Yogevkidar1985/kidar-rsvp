-- KIDAR RSVP 2.0 — the Kidar family event. Run once, after 0001_init.sql.
-- Replace the two e-mail addresses below with the addresses Yogev and Avia will sign in with.
with ev as (
  insert into public.events (slug, name, hosts, headline, intro_text, closing_text, event_date, weekday_label, hebrew_date, reception_time, published)
  values ('kidar-brit', 'מסיבת הברית של משפחת קידר', 'אביה ויוגב קידר', 'נולד לנו בן',
          E'בשמחה ובהתרגשות אנו מזמינים אתכם\nלמסיבת הברית של בננו', 'נשמח לראותכם',
          date '2026-12-02', 'יום רביעי', 'כ״ב בכסלו התשפ״ז', '15:00', false)
  returning id
), integ as (
  insert into public.integrations (event_id, type, name, config)
  select id, 'greenapi', 'WhatsApp (Green API)',
         '{"recipients":[{"name":"יוגב קידר","phone":"0543049491"},{"name":"אביה קידר","phone":"0559991052"}]}'::jsonb
  from ev
)
insert into public.admin_invites (email, event_id, role)
select lower(e), ev.id, 'owner'::public.member_role
from ev, unnest(array['YOGEV_EMAIL@example.com', 'AVIA_EMAIL@example.com']) as e;

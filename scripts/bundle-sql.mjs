// Joins the database updates into one file the admin screen can hand to the owner (public/setup.sql). Runs before every build.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const parts = ['supabase/migrations/0002_whatsapp.sql', 'supabase/migrations/0003_links_analytics.sql', 'supabase/migrations/0004_green_api.sql', 'supabase/migrations/0005_phone_optional.sql', 'supabase/cron_tick.sql'];
mkdirSync('public', { recursive: true });
writeFileSync('public/setup.sql', parts.map((p) => readFileSync(p, 'utf8').trim()).join('\n\n') + '\n');
console.log('public/setup.sql written from', parts.length, 'files');

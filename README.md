# KIDAR RSVP 2.0

הזמנה דיגיטלית, אישורי הגעה וניהול אירוע: Next.js 15, TypeScript, Tailwind 4, Supabase (Postgres, Auth, Storage, Realtime).
מערכת עצמאית. אין בה שום חיבור למערכות, ללקוחות או לנתונים של עסק אחר.

## הקמה

### 1. Supabase (בחשבון פרטי, לא עסקי)
1. **איפה:** supabase.com ← New project (תוכנית Free, אזור Frankfurt).
2. **איפה:** SQL Editor ← New query. **מה:** מדביקים את כל `supabase/migrations/0001_init.sql` ומריצים.
3. **איפה:** קובץ `supabase/seed_kidar.sql`. **מה:** מחליפים את `YOGEV_EMAIL@example.com` ו-`AVIA_EMAIL@example.com` באימיילים האמיתיים, מדביקים ב-SQL Editor ומריצים. זה יוצר את האירוע, את נמעני ההתראות ואת ההרשאה לשני החשבונות.
4. **איפה:** Authentication ← URL Configuration. **מה:** ב-Site URL כתובת האתר, וב-Redirect URLs: `https://הדומיין/auth/callback`.

### 2. משתני סביבה (Vercel ← Settings ← Environment Variables)
| משתנה | מאיפה |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase ← Project Settings ← API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | שם, anon / publishable |
| `SUPABASE_SERVICE_ROLE_KEY` | שם, service_role. **סודי, שרת בלבד** |
| `NEXT_PUBLIC_SITE_URL` | כתובת האתר |
| `RSVP_HASH_SECRET` | מחרוזת אקראית ארוכה (`openssl rand -hex 32`) |
| `GREEN_API_INSTANCE_ID`, `GREEN_API_TOKEN` | מהמסוף של Green API. **סודיים** |
| `GREEN_API_URL` | כתובת ה-API של ה-instance (ברירת מחדל `https://api.green-api.com`) |

מפתחות וטוקנים מזינים רק ב-Vercel. לא בצ'אט, לא בקוד ולא ב-git.

### 3. העלאה
```bash
npm install
npm run build        # בדיקה מקומית
git init && git add . && git commit -m "KIDAR RSVP 2.0"
# דוחפים לריפו פרטי חדש ומייבאים אותו ב-Vercel
```

### 4. כניסה ראשונה
1. `https://הדומיין/admin/login` ← "הוזמנתי, אין לי חשבון" ← נרשמים עם האימייל שהוזן בשלב 1.3.
2. "עיצוב ההזמנה": מעלים תמונה, ממלאים מקום וקישורי Waze / Google Maps, ולוחצים "שמירה ופרסום".
3. "התראות וחיבורים" ← "שליחת הודעת בדיקה", כדי לוודא ש-WhatsApp מגיע ליוגב ולאביה.
4. ההזמנה: `https://הדומיין/e/kidar-brit`. קישור אישי למשפחה: כפתור "קישור אישי" בטבלת המוזמנים.

## כללי המערכת
- **כיסאות:** תינוקות לא תופסים כיסא. משפחה שטרם השיבה מחזיקה את המקומות שהוקצו לה.
- **כפילויות:** משפחה מזוהה לפי טלפון (או לפי הקישור האישי). תשובה נוספת מעדכנת את הקיימת.
- **שולחנות:** המסד מסרב לשיבוץ שחורג מהקיבולת.
- **אבטחה:** למפתח הציבורי אין גישה לאף טבלה. ההזמנה הציבורית נטענת בשרת דרך פונקציה שמחזירה רק את שדות ההזמנה. כל שאר הגישה עוברת RLS לפי חברות באירוע (צפייה / עריכה / בעלים). הרשמה אפשרית רק לאימיילים שהוזמנו.
- **התראות:** אישור חדש, עדכון, שינוי סטטוס, שינוי כמות והגעה בפועל נשלחים ל-Green API ולכל Webhook פעיל, ונרשמים בטבלת `notifications`.

## בדיקות
```bash
npm test                  # יחידה + מסד נתונים (המיגרציה האמיתית רצה ב-Postgres בתוך התהליך)
npm run build && node tests/e2e/run.mjs   # דפדפן אמיתי מקצה לקצה, דורש Chrome
```

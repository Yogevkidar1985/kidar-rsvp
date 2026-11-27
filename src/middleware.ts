import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const OPEN = ['/admin/login', '/admin/reset'];

export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const db = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list: { name: string; value: string; options?: Record<string, unknown> }[]) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await db.auth.getUser();
  const path = req.nextUrl.pathname;
  if (!user && !OPEN.some((p) => path.startsWith(p))) {
    if (path.startsWith('/api/')) return NextResponse.json({ ok: false }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = '/admin/login'; url.search = '';
    return NextResponse.redirect(url);
  }
  if (user && path === '/admin/login') {
    const url = req.nextUrl.clone();
    url.pathname = '/admin'; url.search = '';
    return NextResponse.redirect(url);
  }
  return res;
}
export const config = { matcher: ['/admin/:path*', '/api/admin/:path*'] };

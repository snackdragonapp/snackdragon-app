import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { safeNextPath } from '@/lib/safeNext';

const PUBLIC_PATHS = new Set([
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
]);

function isSetupPath(pathname: string) {
  return pathname === '/setup' || pathname.startsWith('/setup/');
}

export async function updateSession(request: NextRequest) {
  // Prepare a response we can attach cookies to
  const response = NextResponse.next();

  const supabase = createServerClient(
    process.env.SUPABASE_URL!, // you already have these in .env.local
    process.env.SUPABASE_ANON_KEY!, // (anon/public key)
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          // ✅ Allowed here
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: any) {
          response.cookies.set({
            name,
            value: '',
            ...options,
            expires: new Date(0),
          });
        },
      },
    }
  );

  // Trigger refresh if needed; any cookie writes happen on `response`
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Phase 2 setup gate: signed-in users must have at least one active dog
  const pathname = request.nextUrl.pathname;
  if (user && !PUBLIC_PATHS.has(pathname) && !isSetupPath(pathname)) {
    const { data: dogs, error } = await supabase
      .from('dogs')
      .select('id')
      .is('archived_at', null)
      .limit(1);

    if (!error && (dogs ?? []).length === 0) {
      const rawNext = `${request.nextUrl.pathname}${request.nextUrl.search}`;
      const next = safeNextPath(rawNext) ?? '/';

      const url = new URL('/setup', request.url);
      url.searchParams.set('next', next);

      const redirectResponse = NextResponse.redirect(url);

      // Preserve any auth cookie mutations from the session refresh above.
      for (const c of response.cookies.getAll()) {
        redirectResponse.cookies.set(c);
      }

      return redirectResponse;
    }
  }

  return response;
}

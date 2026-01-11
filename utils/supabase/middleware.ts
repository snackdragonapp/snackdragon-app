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

// Only run the "has active dog" DB check on routes that require a dog context.
function requiresDogContext(pathname: string) {
  return (
    pathname === '/' ||
    pathname === '/dogs' ||
    pathname.startsWith('/dogs/') ||
    pathname === '/dog' ||
    pathname.startsWith('/dog/')
  );
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

  const pathname = request.nextUrl.pathname;

  // Read session (cookie-based) so we can detect when a refresh may be needed.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  // Use verified claims for user identity in middleware gating logic.
  let userId: string | null = null;
  {
    const { data: claimsData } = await supabase.auth.getClaims();
    userId = claimsData?.claims?.sub ?? null;
  }

  // If a session exists but claims are missing (e.g., expired access token),
  // trigger a refresh to ensure we don’t treat a refreshable user as logged out.
  if (!userId && session) {
    await supabase.auth.getUser();

    const { data: refreshedClaimsData } = await supabase.auth.getClaims();
    userId = refreshedClaimsData?.claims?.sub ?? null;
  }

  // Phase 2 setup gate: signed-in users must have at least one active dog
  if (
    userId &&
    requiresDogContext(pathname) &&
    !PUBLIC_PATHS.has(pathname) &&
    !isSetupPath(pathname)
  ) {
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

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getClientEnv } from "@/lib/env";

/**
 * Runs before every rendered route to:
 *
 * 1. Refresh the Supabase session and write rotated tokens back as cookies —
 *    Server Components cannot set cookies, so this is the only place a refresh
 *    can be persisted.
 * 2. Redirect unauthenticated visitors away from private pages, and signed-in
 *    users away from the sign-in/sign-up pages.
 *
 * This is an optimistic gate for navigation only. The real authorization checks
 * live in the data access layer and in database RLS policies.
 */

/** Everything else requires a session. Deny by default. */
const PUBLIC_PATHS = ["/", "/sign-in", "/sign-up"];
const PUBLIC_PREFIXES = ["/auth/"];
const AUTH_PATHS = ["/sign-in", "/sign-up"];

function isPublic(pathname: string): boolean {
  return (
    PUBLIC_PATHS.includes(pathname) ||
    PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const env = getClientEnv();

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }

          response = NextResponse.next({ request });

          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }

          // Keeps responses that carry a rotated session out of shared caches.
          for (const [key, headerValue] of Object.entries(headers ?? {})) {
            response.headers.set(key, headerValue);
          }
        },
      },
    },
  );

  // Must run before a response is produced, otherwise a refresh is lost.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // An account whose email address has not been confirmed navigates as though
  // it were signed out; the data access layer applies the same rule.
  const signedIn = Boolean(user?.email_confirmed_at);

  const { pathname, search } = request.nextUrl;

  if (!signedIn && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = "";
    // Send the visitor back where they were headed after signing in.
    url.searchParams.set("next", `${pathname}${search}`);
    return redirectPreservingCookies(url, response);
  }

  if (signedIn && AUTH_PATHS.includes(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return redirectPreservingCookies(url, response);
  }

  return response;
}

/** Carries refreshed session cookies onto a redirect so they are not dropped. */
function redirectPreservingCookies(url: URL, source: NextResponse) {
  const redirectResponse = NextResponse.redirect(url);

  for (const cookie of source.cookies.getAll()) {
    redirectResponse.cookies.set(cookie);
  }

  return redirectResponse;
}

export const config = {
  matcher: [
    /*
     * Every path except Next internals and static assets — auth checks should
     * not be skipped by accident, but they must not block CSS, JS or images.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};

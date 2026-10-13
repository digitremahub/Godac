import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = [
  "/",
  "/modules",
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/auth/callback",
  "/auth/confirm",
  "/mentions-legales",
  "/cgu",
  "/cgv",
  "/dpa",
  "/sla",
  "/confidentialite",
  "/contact",
  "/bon-de-commande",
  // « Voir la démo » signs the visitor into the demo organization.
  "/demo",
];
const PUBLIC_PREFIXES = [
  "/api/webhooks",
  "/api/cron",
  // Lot 7: a chauffeur's QR badge is their login for a `pin`-auth
  // account — both must work signed out. Scoped to exactly these two
  // prefixes (not all of /scan or /api/auth) so vehicle/tank badges
  // and every other auth-only route stay gated as before.
  "/driver-pin",
  "/api/auth/driver-pin",
  "/scan/driver",
  // Self-service driver signup (app/join/[token]) — a chauffeur who
  // has no account yet scans this before ever signing in.
  "/join",
  "/api/public/driver-signup",
  "/api/public/demo-request",
];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Refreshes the Supabase session cookie on every request (required by
 * @supabase/ssr) and gates everything except the public paths above
 * behind "is signed in". It deliberately does NOT check for an
 * organisation here — that would mean a DB round trip on every
 * request; (app/(dashboard)/layout.tsx already queries `users` to
 * render the page, so it's the natural place to redirect a
 * signed-in-but-orgless user to /onboarding.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  if (!user && !isPublicPath(pathname)) {
    const signInUrl = request.nextUrl.clone();
    signInUrl.pathname = "/sign-in";
    signInUrl.searchParams.set("redirect_to", pathname);
    return NextResponse.redirect(signInUrl);
  }

  if (user && (pathname === "/sign-in" || pathname === "/sign-up")) {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = "/dashboard";
    return NextResponse.redirect(dashboardUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};

import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks(.*)",
  "/api/cron(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) {
    return NextResponse.next();
  }

  const { userId, orgId, redirectToSignIn } = await auth();

  if (!userId) {
    return redirectToSignIn({ returnBackUrl: req.url });
  }

  // Every authenticated area other than onboarding requires an active
  // Clerk organisation (== a GODAC tenant). Users without one yet are
  // funnelled through onboarding to create/join one. /godac-staff is
  // the GODAC-side (not client-side) backoffice from Module 9 — it
  // authorizes by email allowlist instead, see app/godac-staff/page.tsx.
  if (
    !orgId &&
    !req.nextUrl.pathname.startsWith("/onboarding") &&
    !req.nextUrl.pathname.startsWith("/godac-staff")
  ) {
    const onboardingUrl = new URL("/onboarding", req.url);
    return NextResponse.redirect(onboardingUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};

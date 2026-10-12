/**
 * Where to go after signing in: the page the visitor was sent away
 * from (middleware.ts adds ?redirect_to= — e.g. a truck QR scanned in
 * the phone's browser), never an outside URL.
 */
export function safeRedirectPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/dashboard";
  if (raw.startsWith("/sign-in") || raw.startsWith("/sign-up")) return "/dashboard";
  return raw;
}

/** Client-side: the current URL's redirect_to, sanitized. */
export function postLoginPath(): string {
  if (typeof window === "undefined") return "/dashboard";
  return safeRedirectPath(new URLSearchParams(window.location.search).get("redirect_to"));
}

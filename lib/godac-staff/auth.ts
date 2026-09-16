import "server-only";

/**
 * GODAC's own operator backoffice (Module 9, "côté GODAC pas côté
 * client") is authorized by a plain email allowlist rather than a
 * Clerk role — it manages every tenant organisation, so it
 * deliberately sits outside the org-scoped RLS model entirely and
 * uses the service-role Supabase client directly.
 */
export function isGodacStaffEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const allowlist = (process.env.GODAC_STAFF_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowlist.includes(email.toLowerCase());
}

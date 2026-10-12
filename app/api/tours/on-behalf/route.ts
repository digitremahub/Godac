import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { requireAppUser } from "@/lib/auth/session";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { issueOnBehalfToken } from "@/lib/tours/on-behalf";

const bodySchema = z.object({
  colleague_id: z.string().uuid(),
  pin: z.string().min(4).max(12),
});

const HELPER_ROLES = new Set(["chauffeur", "manager_chauffeur", "manager", "direction"]);
const DRIVER_ROLES = new Set(["chauffeur", "manager_chauffeur"]);

/**
 * « Dépanner un collègue », step 1: the colleague's badge was scanned
 * (colleague_id) and they typed their own PIN on the helper's phone.
 * The PIN is the colleague's Supabase password (see
 * app/api/auth/driver-pin), so it's checked with a throwaway,
 * session-less anon client — the helper's own session is never
 * touched — and that temporary session is revoked right away.
 * Success returns a 10-minute token scoped to helper + colleague +
 * organization (lib/tours/on-behalf.ts) plus whether the colleague has
 * a tour to close or one to open.
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  if (!HELPER_ROLES.has(appUser.role)) {
    return NextResponse.json({ error: "Votre rôle ne permet pas de dépanner un collègue." }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Badge ou code PIN manquant." }, { status: 400 });
  }
  const { colleague_id: colleagueId, pin } = parsed.data;
  if (colleagueId === appUser.id) {
    return NextResponse.json({ error: "C'est votre propre badge — utilisez Démarrer / Terminer une tournée." }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const { data: colleague } = await admin
    .from("users")
    .select("id, organization_id, full_name, email, role, active, pending_approval, auth_method, pin_set_at")
    .eq("id", colleagueId)
    .maybeSingle();

  // Same answer for "not found" and "other organization": never
  // confirm that a badge id exists elsewhere.
  if (!colleague || colleague.organization_id !== appUser.organization_id) {
    return NextResponse.json({ error: "Badge inconnu dans votre entreprise." }, { status: 404 });
  }
  if (!colleague.active || colleague.pending_approval) {
    return NextResponse.json({ error: "Le compte de ce collègue n'est pas actif." }, { status: 403 });
  }
  if (!DRIVER_ROLES.has(colleague.role)) {
    return NextResponse.json({ error: "Ce badge n'est pas celui d'un chauffeur." }, { status: 422 });
  }
  if (colleague.auth_method !== "pin" || !colleague.pin_set_at || !colleague.email) {
    return NextResponse.json(
      { error: "Ce collègue n'a pas encore de code PIN — il doit d'abord se connecter une fois avec son badge." },
      { status: 422 },
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const probe = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: pinError } = await probe.auth.signInWithPassword({ email: colleague.email, password: pin });
  if (pinError) {
    return NextResponse.json({ error: "Code PIN incorrect." }, { status: 401 });
  }
  // Revoke only this throwaway session — never the colleague's others.
  await probe.auth.signOut({ scope: "local" });

  const { data: openTour } = await admin
    .from("planning_entries")
    .select("id")
    .eq("organization_id", appUser.organization_id)
    .eq("driver_id", colleague.id)
    .eq("status", "in_progress")
    .maybeSingle();

  return NextResponse.json({
    token: issueOnBehalfToken(appUser.id, colleague.id, appUser.organization_id),
    colleague: { id: colleague.id, full_name: colleague.full_name },
    hasOpenTour: Boolean(openTour),
  });
}

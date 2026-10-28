import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { isGodacStaffEmail } from "@/lib/godac-staff/auth";
import { appliquerAction } from "@/lib/comptes-essai/actions";
import { corpsActionSchema } from "@/lib/comptes-essai/regles";

/**
 * Staff GODAC : suspend, rétablit ou révoque un compte (organisation), ou
 * termine son essai GO Navigation. Contrôle d'accès identique aux routes
 * voisines (liste GODAC_STAFF_EMAILS, aucun accès pour un utilisateur
 * client) ; écriture par la clé de service ; motif obligatoire ; tracé au
 * journal d'audit. Organisations de démonstration : jamais. Organisation du
 * staff lui-même : nom exact à retaper (voir verifierAction).
 *
 *   POST { action: "suspendre" | "retablir" | "revoquer" | "terminer_essai", motif, confirmation_nom? }
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userClient = await createServerSupabaseClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!isGodacStaffEmail(user?.email)) return NextResponse.json({ error: "Accès réservé au personnel GODAC" }, { status: 403 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Organisation introuvable." }, { status: 404 });

  const parsed = corpsActionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Requête invalide." }, { status: 400 });

  const admin = createAdminSupabaseClient();
  // Organisation de la personne connectée : sa propre suspension exige une confirmation renforcée.
  const { data: profil } = await admin.from("users").select("organization_id").eq("id", user!.id).maybeSingle();
  const organisationDuStaffId = (profil as { organization_id?: string } | null)?.organization_id ?? null;

  const r = await appliquerAction(admin, {
    action: parsed.data.action,
    organisationId: id,
    motif: parsed.data.motif,
    par: user!.email!,
    organisationDuStaffId,
    confirmationNom: parsed.data.confirmation_nom,
  });
  if (!r.ok) return NextResponse.json({ error: r.message, code: r.code }, { status: r.statut });
  return NextResponse.json(r);
}

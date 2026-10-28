import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { isGodacStaffEmail } from "@/lib/godac-staff/auth";
import { journaliser } from "@/lib/audit/journal";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";

const corps = z
  .object({
    /** Litige déclaré : vrai bloque tout préavis et toute suppression, faux lève le blocage. */
    suppression_bloquee: z.boolean().optional(),
    /** Motif du blocage (obligatoire quand on bloque). */
    motif: z.string().trim().max(500).optional(),
    /** Date de fin de contrat (AAAA-MM-JJ) pour un client facturé hors Stripe ; null la retire. */
    contrat_termine_le: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()]).optional(),
  })
  .refine((v) => v.suppression_bloquee !== undefined || v.contrat_termine_le !== undefined, { message: "Rien à modifier." })
  .refine((v) => v.suppression_bloquee !== true || (v.motif ?? "").length >= 5, { message: "Indiquez le motif du blocage (5 caractères au moins)." });

/**
 * Staff GODAC : bloque ou débloque la suppression des données d'une organisation
 * (litige déclaré) et pose ou retire sa date de fin de contrat (client facturé hors
 * Stripe). Écriture par la clé de service : un trigger interdit ces colonnes aux
 * utilisateurs de l'entreprise cliente. Tracé au journal d'audit.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userClient = await createServerSupabaseClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!isGodacStaffEmail(user?.email)) return NextResponse.json({ error: "Accès réservé au personnel GODAC" }, { status: 403 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Organisation introuvable." }, { status: 404 });

  const parsed = corps.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Requête invalide." }, { status: 400 });
  const { suppression_bloquee, motif, contrat_termine_le } = parsed.data;
  const par = user!.email!.toLowerCase();

  const maj: Record<string, unknown> = {};
  if (suppression_bloquee === true) Object.assign(maj, { suppression_bloquee: true, suppression_bloquee_motif: motif, suppression_bloquee_le: new Date().toISOString(), suppression_bloquee_par: par });
  if (suppression_bloquee === false) Object.assign(maj, { suppression_bloquee: false, suppression_bloquee_motif: null, suppression_bloquee_le: null, suppression_bloquee_par: null });
  if (contrat_termine_le !== undefined) {
    // Une nouvelle date repart de zéro : l'ancien préavis ne compte plus.
    Object.assign(maj, { contrat_termine_le: contrat_termine_le ? `${contrat_termine_le}T00:00:00Z` : null, suppression_preavis_envoye_le: null });
  }

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.from("organizations").update(maj).eq("id", id).select("id").maybeSingle();
  if (error) {
    if (estSchemaManquant(error)) return NextResponse.json({ error: "Migration 20261112000001 pas encore appliquée." }, { status: 409 });
    console.error("fin de contrat (staff)", error.message);
    return NextResponse.json({ error: "Modification impossible." }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Organisation introuvable." }, { status: 404 });

  if (suppression_bloquee !== undefined) {
    await journaliser({ organizationId: id, userId: null, action: "fin_contrat_suppression_bloquee", targetTable: "organizations", targetId: id, details: { bloquee: suppression_bloquee, motif: motif ?? null, par } });
  }
  if (contrat_termine_le !== undefined) {
    await journaliser({ organizationId: id, userId: null, action: "fin_contrat_date_modifiee", targetTable: "organizations", targetId: id, details: { contrat_termine_le, par } });
  }
  return NextResponse.json({ ok: true });
}

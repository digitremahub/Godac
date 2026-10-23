import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { journaliser } from "@/lib/audit/journal";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { chargerSuiviEcarts } from "@/lib/fuel/ecarts-serveur";
import { alerterNiveauSuperieur, compterDirection, lirePersonne, tracerAutoValidation } from "@/lib/hierarchie/serveur";
import { libelleDecideurs } from "@/lib/hierarchie/demandes";
import {
  ACTIONS_ECART,
  COMMENTAIRE_MAX,
  COMMENTAIRE_MIN,
  actionAutorisee,
  droitsEcart,
  ecartsDuPlein,
  statutEcart,
  tableAbsente,
} from "@/lib/fuel/ecarts";

const bodySchema = z.object({
  action: z.enum(ACTIONS_ECART),
  commentaire: z
    .string()
    .trim()
    .min(COMMENTAIRE_MIN, "Le commentaire est obligatoire.")
    .max(COMMENTAIRE_MAX, `Commentaire limité à ${COMMENTAIRE_MAX} caractères.`),
});

/** Types d'alertes d'écart soldées quand l'écart est justifié / classé. */
const ALERTES_ECART = ["totalizer_gap", "price_anomaly", "consumption_anomaly"];

const MIGRATION_ABSENTE = "Le traitement des écarts n'est pas encore activé (migration 20261022000001 à appliquer).";

/**
 * Traitement de l'écart carburant d'un plein :
 * - « traite » : justifier / classer (commentaire obligatoire) — les
 *   alertes d'écart liées au plein passent à « résolue » ;
 * - « explication_demandee » : alerte personnelle au chauffeur du plein ;
 * - « reponse_chauffeur » : le chauffeur répond, l'encadrement est alerté.
 *
 * Encadrement (manager du service, exploitation, direction) pour les deux
 * premières, selon la hiérarchie des demandes (lib/hierarchie) : jamais
 * son propre plein (sauf direction seule, tracée), rang strictement
 * supérieur à celui du conducteur du plein. Mêmes règles en base (RLS de
 * fuel_gap_reviews, migration 20261022000001 ; migration 20261101000001).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ ecran: "carburant.pleins" });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const premier = parsed.error.issues[0]?.message;
    return NextResponse.json({ error: premier ?? "Données invalides." }, { status: 400 });
  }
  const { action, commentaire } = parsed.data;

  // Lecture sous RLS : un plein invisible pour cette personne est introuvable.
  const { data: plein } = await supabase
    .from("fuel_entries")
    .select("id, organization_id, driver_id, vehicle_id, occurred_at, liters, unit_price, totalizer_before, totalizer_after, totalizer_gap, gap_flagged, pmp_at_entry, tank_id, ocr_raw, vehicles(registration, service_id)")
    .eq("id", id)
    .maybeSingle();
  if (!plein) return NextResponse.json({ error: "Plein introuvable." }, { status: 404 });

  const suivi = await chargerSuiviEcarts(supabase, [id]);
  if (!suivi.traitementDisponible) return NextResponse.json({ error: MIGRATION_ABSENTE }, { status: 503 });
  const ecarts = ecartsDuPlein(plein, suivi.alertes.get(id) ?? []);
  const statut = statutEcart(ecarts.length, suivi.traitements.get(id) ?? []);
  if (statut === "aucun") return NextResponse.json({ error: "Aucun écart à traiter sur ce plein." }, { status: 422 });
  if (statut === "traite" && action !== "reponse_chauffeur") {
    return NextResponse.json({ error: "Cet écart a déjà été traité." }, { status: 409 });
  }

  const conducteur = plein.driver_id ? await lirePersonne(supabase, appUser.organization_id, plein.driver_id) : null;
  const directionCount = await compterDirection(supabase, appUser.organization_id);
  const droits = droitsEcart({ role: appUser.role, userId: appUser.id, driverId: plein.driver_id, statut, roleChauffeur: conducteur?.role, directionCount });
  if (!actionAutorisee(action, droits)) {
    const message =
      action === "reponse_chauffeur"
        ? "Seul le chauffeur du plein répond à une demande d'explication en cours."
        : plein.driver_id === appUser.id
          ? `Vous ne pouvez pas traiter l'écart de votre propre plein : il doit être traité par ${libelleDecideurs(appUser.role)}.`
          : conducteur && ["manager", "exploitation", "direction"].includes(conducteur.role) && ["manager", "exploitation", "direction", "chauffeur"].includes(appUser.role)
            ? `L'écart de ce plein doit être traité par ${libelleDecideurs(conducteur.role)}.`
            : "Action réservée à l'encadrement (manager, exploitation, direction).";
    return NextResponse.json({ error: message, code: "ROLE_REFUSE" }, { status: 403 });
  }

  if (action !== "reponse_chauffeur" && plein.driver_id === appUser.id) await tracerAutoValidation(appUser, { table: "fuel_entries", id, decision: action });

  const { data: ligne, error: insertError } = await supabase
    .from("fuel_gap_reviews")
    .insert({ organization_id: appUser.organization_id, fuel_entry_id: id, action, commentaire, created_by: appUser.id })
    .select("id, action, commentaire, created_at")
    .single();
  if (insertError) {
    if (tableAbsente(insertError)) return NextResponse.json({ error: MIGRATION_ABSENTE }, { status: 503 });
    return NextResponse.json({ error: insertError.message }, { status: insertError.code === "42501" ? 403 : 500 });
  }

  // Alertes : la RLS n'autorise aucune écriture dans alerts aux clients
  // (seuls triggers et service) — même passage par le client service que
  // app/api/fines/[id], droits déjà vérifiés ci-dessus et par la RLS.
  const admin = createAdminSupabaseClient();
  const vehicule = (Array.isArray(plein.vehicles) ? plein.vehicles[0] : plein.vehicles) as { registration: string; service_id: string | null } | null;
  const quand = new Date(plein.occurred_at).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" });
  const extrait = commentaire.length > 200 ? `${commentaire.slice(0, 197)}…` : commentaire;

  if (action === "traite") {
    const { error: resolError } = await admin
      .from("alerts")
      .update({ status: "resolved", acknowledged_by: appUser.id, acknowledged_at: new Date().toISOString() })
      .eq("organization_id", appUser.organization_id)
      .eq("related_table", "fuel_entries")
      .eq("related_id", id)
      .in("type", [...ALERTES_ECART, "fuel_gap_explanation"])
      .neq("status", "resolved");
    if (resolError) console.error("alertes d'écart carburant", resolError.message);
    await journaliser({
      organizationId: appUser.organization_id,
      userId: appUser.id,
      action: "ecart_carburant_traite",
      targetTable: "fuel_entries",
      targetId: id,
      details: { commentaire, ecarts: ecarts.map((x) => x.code) },
    });
  } else if (action === "explication_demandee") {
    const { error: alertError } = await admin.from("alerts").insert({
      organization_id: appUser.organization_id,
      type: "fuel_gap_explanation",
      severity: "warning",
      message: `Explication demandée sur votre plein du ${quand}${vehicule?.registration ? ` (${vehicule.registration})` : ""} : ${extrait}`,
      related_table: "fuel_entries",
      related_id: id,
      recipient_user_id: plein.driver_id,
    });
    if (alertError) return NextResponse.json({ error: `Demande enregistrée, mais le chauffeur n'a pas pu être alerté : ${alertError.message}` }, { status: 500 });
    await journaliser({
      organizationId: appUser.organization_id,
      userId: appUser.id,
      action: "ecart_carburant_explication",
      targetTable: "fuel_entries",
      targetId: id,
      details: { commentaire, ecarts: ecarts.map((x) => x.code) },
    });
  } else {
    // La réponse monte d'un niveau au-dessus du conducteur (jamais vers lui ni un pair).
    const alertError = await alerterNiveauSuperieur(admin, {
      organizationId: appUser.organization_id,
      demandeurId: appUser.id,
      type: "fuel_gap_explanation",
      severity: "info",
      message: `${appUser.full_name} a répondu sur l'écart de son plein du ${quand}${vehicule?.registration ? ` (${vehicule.registration})` : ""} : ${extrait}`,
      relatedTable: "fuel_entries",
      relatedId: id,
    });
    if (alertError) console.error("alerte réponse écart carburant", alertError);
  }

  return NextResponse.json({ traitement: ligne });
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { estSchemaManquant, estValeurEnumInconnue } from "@/lib/rattachement/tolerance";
import { fetchAllRows } from "@/lib/utils/fetch-all";
import { alertesEcheanceAClore } from "@/lib/alerts/cloture";
import { STATUTS_AMENDE_OUVERTE, echeancesANotifier, echeancesSouhaitees, type AmendeAEcheance, type DocumentVehicule, type EcheanceSouhaitee } from "@/lib/alerts/echeances";

/**
 * Échéances de la flotte d'une organisation, lues par le cron quotidien
 * (client service) et par « À traiter » (sous la RLS de la personne connectée) :
 * papiers des véhicules actifs et date limite de paiement minoré des amendes.
 * Jamais bloquant : colonne ou type d'alerte absent (migrations 20261026000003,
 * 20261108000001 et 20261108000002 pas appliquées), on passe au reste.
 */

const un = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/** Papiers des véhicules actifs (tous les documents : le dernier déposé de chaque type fait foi). */
export async function lireDocumentsVehicules(db: SupabaseClient, organizationId: string): Promise<DocumentVehicule[]> {
  const { rows, error } = await fetchAllRows<any>(
    (a, b) =>
      db
        .from("vehicle_documents")
        .select("id, vehicle_id, doc_type, expires_on, uploaded_at, vehicles!inner(registration, service_id, status)")
        .eq("organization_id", organizationId)
        .eq("vehicles.status", "active")
        .order("id")
        .range(a, b),
    { maxRows: 20000 },
  );
  if (error) {
    if (estSchemaManquant({ message: error })) return [];
    throw new Error(`documents des véhicules : ${error}`);
  }
  return rows.map((r) => {
    const v = un<{ registration: string; service_id: string | null }>(r.vehicles);
    return { id: r.id, vehicle_id: r.vehicle_id, doc_type: r.doc_type, expires_on: r.expires_on, uploaded_at: r.uploaded_at, registration: v?.registration ?? "—", service_id: v?.service_id ?? null };
  });
}

/** Amendes dont le paiement reste à faire et qui ont une date limite. */
export async function lireAmendesAEcheance(db: SupabaseClient, organizationId: string): Promise<AmendeAEcheance[]> {
  const { data, error } = await db
    .from("fines")
    .select("id, status, payment_deadline, amount, reduced_amount, reference, vehicles(registration, service_id)")
    .eq("organization_id", organizationId)
    .in("status", [...STATUTS_AMENDE_OUVERTE])
    .not("payment_deadline", "is", null)
    .limit(2000);
  if (error) {
    // payment_deadline : migration 20261026000003.
    if (estSchemaManquant(error)) return [];
    throw new Error(`amendes : ${error.message}`);
  }
  return ((data ?? []) as any[]).map((r) => {
    const v = un<{ registration: string; service_id: string | null }>(r.vehicles);
    return { id: r.id, status: r.status, payment_deadline: r.payment_deadline, amount: Number(r.amount), reduced_amount: r.reduced_amount === null ? null : Number(r.reduced_amount), reference: r.reference, registration: v?.registration ?? "—", service_id: v?.service_id ?? null };
  });
}

export interface BilanEcheances {
  creees: number;
  closes: number;
}

/**
 * Crée les alertes d'échéance manquantes (une par échéance et par palier),
 * relayées en cloche, push et e-mail par le webhook des alertes, et clôt celles
 * dont la condition a disparu : document renouvelé, amende réglée, palier
 * dépassé par un plus urgent.
 */
export async function surveillerEcheances(
  admin: SupabaseClient,
  organizationId: string,
  aujourdhui: string,
  perimetre: { documents: boolean; amendes: boolean },
): Promise<BilanEcheances> {
  const [documents, amendes] = await Promise.all([
    perimetre.documents ? lireDocumentsVehicules(admin, organizationId) : Promise.resolve([]),
    perimetre.amendes ? lireAmendesAEcheance(admin, organizationId) : Promise.resolve([]),
  ]);
  const souhaitees = echeancesSouhaitees(documents, amendes, aujourdhui);

  // Alertes déjà créées pour ces clés (tous statuts : un palier traité ne se recrée pas).
  const cles = souhaitees.map((e) => e.cle);
  const existantes: { cle_dedoublonnage: string | null }[] = [];
  for (let i = 0; i < cles.length; i += 100) {
    const { data, error } = await admin.from("alerts").select("cle_dedoublonnage").eq("organization_id", organizationId).eq("type", "echeance_vehicule").in("cle_dedoublonnage", cles.slice(i, i + 100));
    if (error) {
      // Type d'alerte ou colonne absents (migrations 20261108000001/2 pas appliquées) : rien à créer ni à clore.
      if (!estSchemaManquant(error) && !estValeurEnumInconnue(error)) console.error("échéances : alertes existantes", error.message);
      return { creees: 0, closes: 0 };
    }
    existantes.push(...((data ?? []) as { cle_dedoublonnage: string | null }[]));
  }

  let creees = 0;
  for (const e of echeancesANotifier(souhaitees, existantes).slice(0, 200)) {
    const { error } = await admin.from("alerts").insert(ligneAlerte(organizationId, e));
    // 23505 : une autre exécution vient de créer la même alerte (index unique).
    if (error && error.code !== "23505") console.error("échéances : alerte", error.message);
    else if (!error) creees++;
  }

  // Clôture : alertes ouvertes dont la clé n'est plus active, pour les genres lus seulement.
  const { data: ouvertes, error: errOuvertes } = await admin
    .from("alerts")
    .select("id, cle_dedoublonnage")
    .eq("organization_id", organizationId)
    .eq("type", "echeance_vehicule")
    .in("status", ["open", "acknowledged"])
    .not("cle_dedoublonnage", "is", null)
    .limit(2000);
  if (errOuvertes) {
    if (!estSchemaManquant(errOuvertes) && !estValeurEnumInconnue(errOuvertes)) console.error("échéances : lecture des alertes ouvertes", errOuvertes.message);
    return { creees, closes: 0 };
  }
  const genresLus = [perimetre.documents ? "document:" : null, perimetre.amendes ? "amende:" : null].filter((g): g is string => g !== null);
  const aClore = alertesEcheanceAClore(
    ((ouvertes ?? []) as { id: string; cle_dedoublonnage: string | null }[]).filter((a) => genresLus.some((g) => a.cle_dedoublonnage!.startsWith(g))),
    new Set(cles),
  );
  let closes = 0;
  for (let i = 0; i < aClore.length; i += 100) {
    const lot = aClore.slice(i, i + 100);
    const { error } = await admin.from("alerts").update({ status: "resolved", acknowledged_at: new Date().toISOString() }).eq("organization_id", organizationId).in("id", lot);
    if (error) console.error("échéances : clôture", error.message);
    else closes += lot.length;
  }
  return { creees, closes };
}

function ligneAlerte(organizationId: string, e: EcheanceSouhaitee) {
  return {
    organization_id: organizationId,
    type: "echeance_vehicule",
    severity: e.severity,
    message: e.message,
    related_table: e.relatedTable,
    related_id: e.relatedId,
    recipient_roles: e.recipientRoles,
    cle_dedoublonnage: e.cle,
    // Le manager ne reçoit que les véhicules de son service (RLS et webhook).
    ...(e.serviceId ? { service_id: e.serviceId } : {}),
  };
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { estSchemaManquant, estValeurEnumInconnue } from "@/lib/rattachement/tolerance";
import { fetchAllRows } from "@/lib/utils/fetch-all";
import { alertesEcheanceAClore } from "@/lib/alerts/cloture";
import { PREFIXE_CLE_RH, echeancesRhANotifier, echeancesRhSouhaitees, type ContratSalarie, type DocumentSalarie, type EcheanceRhSouhaitee } from "@/lib/alerts/echeances-rh";

/**
 * Échéances RH d'une organisation, lues par le cron quotidien (client
 * service) : documents du salarié avec date d'expiration et fin de contrat
 * (contract_end_date). Jamais bloquant : colonne ou type d'alerte absent
 * (migrations 20261109000001 et 20261109000002 pas appliquées), on passe au
 * reste. Les alertes sont relayées en cloche, push et e-mail par le webhook
 * des alertes.
 */

const un = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

async function servicesDes(db: SupabaseClient, userIds: string[]): Promise<Map<string, string>> {
  const premier = new Map<string, string>();
  for (let i = 0; i < userIds.length; i += 200) {
    const { data } = await db.from("user_services").select("user_id, service_id").in("user_id", userIds.slice(i, i + 200));
    for (const l of ((data ?? []) as { user_id: string; service_id: string }[]).sort((a, b) => a.service_id.localeCompare(b.service_id))) if (!premier.has(l.user_id)) premier.set(l.user_id, l.service_id);
  }
  return premier;
}

/** Documents datés des salariés actifs (tous les dépôts : le dernier de chaque type fait foi). */
export async function lireDocumentsSalaries(db: SupabaseClient, organizationId: string): Promise<DocumentSalarie[]> {
  const { rows, error } = await fetchAllRows<any>(
    (a, b) =>
      db
        .from("employee_documents")
        .select("id, doc_type, expires_at, uploaded_at, employee_files!inner(user_id, users!inner(full_name, active))")
        .eq("organization_id", organizationId)
        .order("id")
        .range(a, b),
    { maxRows: 20000 },
  );
  if (error) {
    if (estSchemaManquant({ message: error })) return [];
    throw new Error(`documents des salariés : ${error}`);
  }
  const lignes = rows
    .map((r) => {
      const f = un<{ user_id: string; users: { full_name: string; active: boolean } | { full_name: string; active: boolean }[] | null }>(r.employee_files);
      const u = un(f?.users);
      return f && u?.active ? { id: r.id as string, user_id: f.user_id, nom: u.full_name, doc_type: r.doc_type as string, expires_at: (r.expires_at as string | null) ?? null, uploaded_at: r.uploaded_at as string } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const services = await servicesDes(db, [...new Set(lignes.map((l) => l.user_id))]);
  return lignes.map((l) => ({ ...l, service_id: services.get(l.user_id) ?? null }));
}

/** Fins de contrat à venir des salariés actifs. */
export async function lireContrats(db: SupabaseClient, organizationId: string): Promise<ContratSalarie[]> {
  const { data, error } = await db
    .from("employee_files")
    .select("user_id, contract_end_date, hr_status, users!inner(full_name, active)")
    .eq("organization_id", organizationId)
    .not("contract_end_date", "is", null)
    .limit(5000);
  if (error) {
    if (estSchemaManquant(error)) return [];
    throw new Error(`contrats : ${error.message}`);
  }
  const lignes = ((data ?? []) as any[])
    .map((r) => ({ r, u: un<{ full_name: string; active: boolean }>(r.users) }))
    .filter(({ u }) => u?.active)
    .map(({ r, u }) => ({ user_id: r.user_id as string, nom: u!.full_name, contract_end_date: r.contract_end_date as string, hr_status: (r.hr_status as string | null) ?? null }));
  const services = await servicesDes(db, lignes.map((l) => l.user_id));
  return lignes.map((l) => ({ ...l, service_id: services.get(l.user_id) ?? null }));
}

export interface BilanEcheancesRh {
  creees: number;
  closes: number;
}

/**
 * Crée les alertes d'échéance RH manquantes (une par échéance et par palier) et
 * clôt celles dont la condition a disparu : document renouvelé (nouvelle date ou
 * nouveau fichier), contrat prolongé ou dossier clos, palier dépassé par un plus
 * urgent.
 */
export async function surveillerEcheancesRh(admin: SupabaseClient, organizationId: string, aujourdhui: string): Promise<BilanEcheancesRh> {
  const [documents, contrats] = await Promise.all([lireDocumentsSalaries(admin, organizationId), lireContrats(admin, organizationId)]);
  const souhaitees = echeancesRhSouhaitees(documents, contrats, aujourdhui);

  const cles = souhaitees.map((e) => e.cle);
  const existantes: { cle_dedoublonnage: string | null }[] = [];
  for (let i = 0; i < cles.length; i += 100) {
    const { data, error } = await admin.from("alerts").select("cle_dedoublonnage").eq("organization_id", organizationId).eq("type", "echeance_rh").in("cle_dedoublonnage", cles.slice(i, i + 100));
    if (error) {
      if (!estSchemaManquant(error) && !estValeurEnumInconnue(error)) console.error("échéances RH : alertes existantes", error.message);
      return { creees: 0, closes: 0 };
    }
    existantes.push(...((data ?? []) as { cle_dedoublonnage: string | null }[]));
  }

  let creees = 0;
  for (const e of echeancesRhANotifier(souhaitees, existantes).slice(0, 200)) {
    const { error } = await admin.from("alerts").insert(ligneAlerte(organizationId, e));
    // 23505 : une autre exécution vient de créer la même alerte (index unique).
    if (error && error.code !== "23505") console.error("échéances RH : alerte", error.message);
    else if (!error) creees++;
  }

  const { data: ouvertes, error: errOuvertes } = await admin
    .from("alerts")
    .select("id, cle_dedoublonnage")
    .eq("organization_id", organizationId)
    .eq("type", "echeance_rh")
    .in("status", ["open", "acknowledged"])
    .not("cle_dedoublonnage", "is", null)
    .limit(2000);
  if (errOuvertes) {
    if (!estSchemaManquant(errOuvertes) && !estValeurEnumInconnue(errOuvertes)) console.error("échéances RH : lecture des alertes ouvertes", errOuvertes.message);
    return { creees, closes: 0 };
  }
  const aClore = alertesEcheanceAClore(
    ((ouvertes ?? []) as { id: string; cle_dedoublonnage: string | null }[]).filter((a) => a.cle_dedoublonnage!.startsWith(PREFIXE_CLE_RH)),
    new Set(cles),
  );
  let closes = 0;
  for (let i = 0; i < aClore.length; i += 100) {
    const lot = aClore.slice(i, i + 100);
    const { error } = await admin.from("alerts").update({ status: "resolved", acknowledged_at: new Date().toISOString() }).eq("organization_id", organizationId).in("id", lot);
    if (error) console.error("échéances RH : clôture", error.message);
    else closes += lot.length;
  }
  return { creees, closes };
}

function ligneAlerte(organizationId: string, e: EcheanceRhSouhaitee) {
  return {
    organization_id: organizationId,
    type: "echeance_rh",
    severity: e.severity,
    message: e.message,
    related_table: e.relatedTable,
    related_id: e.relatedId,
    recipient_roles: e.recipientRoles,
    cle_dedoublonnage: e.cle,
    // Un manager ne reçoit que les genres non sensibles de son service (RLS et webhook) ; sans service : jamais pour lui.
    ...(e.serviceId ? { service_id: e.serviceId } : {}),
  };
}

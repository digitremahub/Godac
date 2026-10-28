import type { StatutUnite, TypeMouvement } from "@/lib/stock/transitions";

/**
 * Règles du lien entre une tournée colis et le stock (fichier pur, testé dans
 * lib/stock/__tests__/integration-tournee.test.ts). Les appels réels sont dans
 * lib/stock/integration-tournee.ts : jamais bloquants.
 */

export interface ArretTournee {
  id: string;
  parcel_code: string | null;
  status: "pending" | "delivered" | "failed";
}

export interface UniteLiee {
  id: string;
  code: string;
  statut: StatutUnite;
  site_id: string | null;
}

export interface ActionStock {
  type: TypeMouvement;
  code: string;
  site_id: string;
  stop_id: string;
  statut_apres: "en_tournee" | "livre" | "retour";
  /** Clé d'idempotence : une seule action de ce genre par arrêt, même si l'écran rejoue la requête. */
  cle: string;
}

/** Code de colis d'un arrêt, comparé sans espaces autour. */
export function codeArret(parcelCode: string | null | undefined): string | null {
  const c = (parcelCode ?? "").trim();
  return c ? c : null;
}

function unitePar(unites: readonly UniteLiee[]): Map<string, UniteLiee> {
  return new Map(unites.map((u) => [u.code, u]));
}

/** Au départ : chaque colis de la tournée présent en stock au dépôt est sorti, lié à la tournée et à l'arrêt. */
export function sortiesAuDepart(runId: string, arrets: readonly ArretTournee[], unites: readonly UniteLiee[]): ActionStock[] {
  const parCode = unitePar(unites);
  const vus = new Set<string>();
  const actions: ActionStock[] = [];
  for (const a of arrets) {
    if (a.status !== "pending") continue;
    const code = codeArret(a.parcel_code);
    if (!code || vus.has(code)) continue;
    const u = parCode.get(code);
    if (!u || !u.site_id || (u.statut !== "dans_depot" && u.statut !== "retour")) continue;
    vus.add(code);
    actions.push({ type: "sortie", code, site_id: u.site_id, stop_id: a.id, statut_apres: "en_tournee", cle: `tournee:${runId}:${a.id}:depart` });
  }
  return actions;
}

/** Arrêt livré ou en échec : action sur l'unité correspondante, si elle est en tournée (ou rentrée, pour une livraison après un échec). */
export function actionPourArret(arret: Pick<ArretTournee, "id" | "parcel_code">, nouveauStatut: "delivered" | "failed", unites: readonly UniteLiee[]): ActionStock | null {
  const code = codeArret(arret.parcel_code);
  if (!code) return null;
  const u = unitePar(unites).get(code);
  if (!u || !u.site_id) return null;
  if (nouveauStatut === "delivered") {
    if (u.statut !== "en_tournee" && u.statut !== "retour") return null;
    return { type: "sortie", code, site_id: u.site_id, stop_id: arret.id, statut_apres: "livre", cle: `tournee:${arret.id}:livre` };
  }
  if (u.statut !== "en_tournee") return null;
  return { type: "retour", code, site_id: u.site_id, stop_id: arret.id, statut_apres: "retour", cle: `tournee:${arret.id}:echec` };
}

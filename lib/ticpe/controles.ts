/**
 * Contrôles avant déclaration TICPE — pur, testé. Produit la liste
 * « à régler » d'une période : chaque point a une gravité (bloquant :
 * à corriger avant de déclarer ; avertissement : à regarder) et un lien
 * vers l'objet à corriger (plein, véhicule, réglages).
 */

import { LIBELLES_CATEGORIE_COURTS, LIBELLES_ZONE } from "@/lib/ticpe/bareme";
import type { ResultatEligibilite } from "@/lib/ticpe/eligibilite";
import { jourParis, type Depassement, type LigneTicpe } from "@/lib/ticpe/montant";

export type Gravite = "bloquant" | "avertissement";

export type CodeControle =
  | "plein_non_valide"
  | "sans_justificatif"
  | "cuve_sans_facture"
  | "litres_reservoir"
  | "consommation"
  | "doublon"
  | "ptac_inconnu"
  | "hors_periode"
  | "plafond"
  | "taux_manquant"
  | "location_loueur"
  | "vehicule_a_verifier"
  | "vehicule_a_regulariser";

export interface PointARegler {
  cle: string;
  code: CodeControle;
  gravite: Gravite;
  titre: string;
  detail: string;
  lien: string;
  objet: { type: "plein" | "vehicule" | "reglages"; id: string | null };
}

export const LIBELLES_CONTROLE: Record<CodeControle, string> = {
  plein_non_valide: "Plein à valider",
  sans_justificatif: "Plein sans justificatif",
  cuve_sans_facture: "Cuve sans facture de livraison",
  litres_reservoir: "Plus de litres que le réservoir",
  consommation: "Consommation anormale",
  doublon: "Doublon probable",
  ptac_inconnu: "PTAC inconnu",
  hors_periode: "Véhicule hors période d'éligibilité",
  plafond: "Plafond de volume dépassé",
  taux_manquant: "Taux manquant",
  location_loueur: "Véhicule loué : remboursement demandé par le loueur",
  vehicule_a_verifier: "Véhicule à vérifier",
  vehicule_a_regulariser: "Véhicule à régulariser",
};

export interface PleinControle {
  id: string;
  vehicle_id: string;
  occurred_at: string;
  liters: number | string | null;
  status: string;
  tank_id?: string | null;
  station_name?: string | null;
}

export interface VehiculeControle {
  registration: string;
  tank_capacity_liters?: number | string | null;
  eligibilite: ResultatEligibilite;
}

function nombre(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const L = (n: number) => `${n.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} L`;
const dateHeure = (iso: string) => new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" });

/** Écart maximal pour un doublon : 30 minutes, litres à 1 L ou 2 % près. */
export const DOUBLON_MINUTES = 30;

export function litresProches(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1, 0.02 * Math.max(a, b));
}

/**
 * Paires de pleins probablement saisis deux fois (ex. ticket photographié
 * et ligne du relevé de carte) : même véhicule, à 30 minutes au plus,
 * litres proches.
 */
export function doublonsProbables<P extends Pick<PleinControle, "id" | "vehicle_id" | "occurred_at" | "liters">>(pleins: readonly P[]): [P, P][] {
  const parVehicule = new Map<string, P[]>();
  for (const p of pleins) {
    if (nombre(p.liters) === null) continue;
    const l = parVehicule.get(p.vehicle_id) ?? [];
    l.push(p);
    parVehicule.set(p.vehicle_id, l);
  }
  const paires: [P, P][] = [];
  for (const liste of parVehicule.values()) {
    liste.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
    for (let i = 0; i < liste.length; i++) {
      const a = liste[i]!;
      const ta = new Date(a.occurred_at).getTime();
      for (let j = i + 1; j < liste.length; j++) {
        const b = liste[j]!;
        if (new Date(b.occurred_at).getTime() - ta > DOUBLON_MINUTES * 60000) break;
        if (litresProches(nombre(a.liters)!, nombre(b.liters)!)) paires.push([a, b]);
      }
    }
  }
  return paires;
}

export interface EntreeControles {
  periode: { debut: string; fin: string };
  /** Lignes TICPE (plafond appliqué) — au moins celles de la période. */
  lignes: readonly LigneTicpe[];
  pleins: ReadonlyMap<string, PleinControle>;
  vehicules: ReadonlyMap<string, VehiculeControle>;
  depassements: readonly Depassement[];
  /** Pleins liés à une alerte de consommation anormale (écarts carburant). */
  anomaliesConsommation?: ReadonlySet<string>;
}

const STATUTS_FIABLES = ["manual", "validated"];
const lienPlein = (id: string) => `/carburant/pleins?plein=${id}`;
const lienVehicule = (id: string) => `/flotte/vehicules/${id}`;

export function controlesPeriode(e: EntreeControles): PointARegler[] {
  const { debut, fin } = e.periode;
  const points: PointARegler[] = [];
  const dans = (jour: string) => jour >= debut && jour <= fin;
  const immat = (vid: string) => e.vehicules.get(vid)?.registration ?? "véhicule inconnu";
  const lignesPeriode = e.lignes.filter((l) => dans(l.jour));
  const ajouter = (p: Omit<PointARegler, "titre"> & { titre?: string }) => points.push({ titre: LIBELLES_CONTROLE[p.code], ...p });

  // Pleins de la période par véhicule (pour les points « véhicule »).
  const parVehicule = new Map<string, LigneTicpe[]>();
  for (const l of lignesPeriode) {
    const liste = parVehicule.get(l.vehicle_id) ?? [];
    liste.push(l);
    parVehicule.set(l.vehicle_id, liste);
  }

  for (const l of lignesPeriode) {
    const p = e.pleins.get(l.id);
    const v = e.vehicules.get(l.vehicle_id);
    const qui = `${immat(l.vehicle_id)} · ${dateHeure(l.occurred_at)} · ${L(l.litres)}`;
    const vehiculeCompte = v && v.eligibilite.statut !== "exclu";

    if (p && !STATUTS_FIABLES.includes(p.status) && vehiculeCompte) {
      ajouter({ cle: `non_valide:${l.id}`, code: "plein_non_valide", gravite: "bloquant", detail: `${qui} : pas encore validé, il n'est pas compté.`, lien: lienPlein(l.id), objet: { type: "plein", id: l.id } });
    }
    if (l.statut === "exclu") {
      if (l.raison?.includes("hors de la période")) {
        ajouter({ cle: `hors_periode:${l.id}`, code: "hors_periode", gravite: "avertissement", detail: `${qui} : plein en dehors de la période d'éligibilité du véhicule, non compté.`, lien: lienVehicule(l.vehicle_id), objet: { type: "vehicule", id: l.vehicle_id } });
      }
      continue;
    }
    if (!l.justificatif.present) {
      if (l.justificatif.type === "livraison_cuve") {
        ajouter({ cle: `cuve:${l.id}`, code: "cuve_sans_facture", gravite: "avertissement", detail: `${qui} : aucune facture de livraison enregistrée pour la cuve.`, lien: "/carburant/approvisionnements", objet: { type: "plein", id: l.id } });
      } else {
        ajouter({ cle: `justif:${l.id}`, code: "sans_justificatif", gravite: "bloquant", detail: `${qui} : ni photo de ticket, ni relevé de carte, ni facture.`, lien: lienPlein(l.id), objet: { type: "plein", id: l.id } });
      }
    }
    const capacite = nombre(v?.tank_capacity_liters);
    if (capacite !== null && capacite > 0 && l.litres > capacite) {
      ajouter({ cle: `reservoir:${l.id}`, code: "litres_reservoir", gravite: "avertissement", detail: `${qui} : plus que la capacité du réservoir (${L(capacite)}).`, lien: lienPlein(l.id), objet: { type: "plein", id: l.id } });
    }
    if (e.anomaliesConsommation?.has(l.id)) {
      ajouter({ cle: `conso:${l.id}`, code: "consommation", gravite: "avertissement", detail: `${qui} : consommation au 100 km inhabituelle (écart carburant).`, lien: lienPlein(l.id), objet: { type: "plein", id: l.id } });
    }
  }

  // Doublons probables parmi les pleins fiables de la période.
  const fiables = [...e.pleins.values()].filter((p) => STATUTS_FIABLES.includes(p.status) && dans(jourParis(p.occurred_at)));
  for (const [a, b] of doublonsProbables(fiables)) {
    ajouter({
      cle: `doublon:${a.id}:${b.id}`,
      code: "doublon",
      gravite: "bloquant",
      detail: `${immat(a.vehicle_id)} : ${L(nombre(a.liters)!)} le ${dateHeure(a.occurred_at)} et ${L(nombre(b.liters)!)} le ${dateHeure(b.occurred_at)} (ticket et relevé de carte ?).`,
      lien: lienPlein(b.id),
      objet: { type: "plein", id: b.id },
    });
  }

  // Points par véhicule ayant des pleins sur la période.
  for (const [vid, lignes] of parVehicule) {
    const v = e.vehicules.get(vid);
    if (!v) continue;
    const comptes = lignes.filter((l) => l.statut !== "exclu").length;
    const nonComptes = lignes.length - comptes;
    for (const r of v.eligibilite.raisons) {
      if (r.code === "ptac_inconnu" && comptes > 0) {
        ajouter({ cle: `ptac:${vid}`, code: "ptac_inconnu", gravite: "bloquant", detail: `${v.registration} (${comptes} plein(s)) : ${r.libelle}`, lien: lienVehicule(vid), objet: { type: "vehicule", id: vid } });
      } else if (r.code === "location_loueur" && lignes.length > 0) {
        ajouter({ cle: `loueur:${vid}`, code: "location_loueur", gravite: "avertissement", detail: `${v.registration} : ${lignes.length} plein(s) non compté(s), le loueur demande le remboursement. Vérifiez avec lui.`, lien: lienVehicule(vid), objet: { type: "vehicule", id: vid } });
      } else if (r.code === "ia_non_confirmee" && nonComptes > 0) {
        ajouter({ cle: `ia:${vid}`, code: "vehicule_a_regulariser", gravite: "avertissement", detail: `${v.registration} : ${nonComptes} plein(s) non compté(s). ${r.libelle}`, lien: lienVehicule(vid), objet: { type: "vehicule", id: vid } });
      } else if (r.gravite === "a_verifier" && r.code !== "ptac_inconnu" && comptes > 0) {
        ajouter({ cle: `verif:${vid}:${r.code}`, code: "vehicule_a_verifier", gravite: "avertissement", detail: `${v.registration} : ${r.libelle}`, lien: lienVehicule(vid), objet: { type: "vehicule", id: vid } });
      }
    }
  }

  // Plafonds dépassés (période de plafond qui recouvre la période).
  for (const d of e.depassements) {
    const annee = d.periode.slice(0, 4);
    if (annee < debut.slice(0, 4) || annee > fin.slice(0, 4)) continue;
    ajouter({
      cle: `plafond:${d.vehicle_id}:${d.periode}`,
      code: "plafond",
      gravite: "avertissement",
      detail: `${immat(d.vehicle_id)} : ${L(d.litres)} sur ${d.periode.replace("-S", " semestre ")} pour un plafond de ${L(d.plafond)} ; ${L(d.litresHorsPlafond)} exclus du montant (plafond à confirmer par l'expert-comptable).`,
      lien: lienVehicule(d.vehicle_id),
      objet: { type: "vehicule", id: d.vehicle_id },
    });
  }

  // Taux manquants, regroupés par activité et zone.
  const manquants = new Map<string, { n: number; litres: number; raison: string }>();
  for (const l of lignesPeriode) {
    if (l.statut !== "taux_manquant") continue;
    const cle = `${l.categorie}|${l.zone}`;
    const m = manquants.get(cle) ?? { n: 0, litres: 0, raison: l.raison ?? "" };
    m.n += 1;
    m.litres += l.litres;
    manquants.set(cle, m);
  }
  for (const [cle, m] of manquants) {
    const [cat, zone] = cle.split("|") as [keyof typeof LIBELLES_CATEGORIE_COURTS, keyof typeof LIBELLES_ZONE];
    ajouter({
      cle: `taux:${cle}`,
      code: "taux_manquant",
      gravite: "bloquant",
      detail: `${LIBELLES_CATEGORIE_COURTS[cat] ?? cat} · ${LIBELLES_ZONE[zone] ?? zone} : ${m.n} plein(s), ${L(m.litres)} sans taux au barème. Ajoutez un taux particulier validé par votre expert-comptable, ou attendez la mise à jour du barème GODAC.`,
      lien: "/carburant/ticpe/reglages",
      objet: { type: "reglages", id: null },
    });
  }

  return points.sort((a, b) => (a.gravite === b.gravite ? 0 : a.gravite === "bloquant" ? -1 : 1));
}

export function compterParGravite(points: readonly PointARegler[]): { bloquants: number; avertissements: number } {
  return { bloquants: points.filter((p) => p.gravite === "bloquant").length, avertissements: points.filter((p) => p.gravite === "avertissement").length };
}


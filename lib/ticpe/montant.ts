/**
 * Montant TICPE par plein, plafond par véhicule — pur, testé.
 *
 * Pour chaque plein de gazole validé d'un véhicule éligible à sa date :
 * zone (Corse si la station ou la cuve est en Corse, sinon métropole),
 * taux du barème à la date du plein (heure de Paris), montant =
 * litres / 100 × taux. Pleins à la cuve : seuls les litres distribués au
 * véhicule (le plein lui-même) comptent, jamais la livraison de la cuve.
 * Aucun plafond de volume par défaut (base légale non confirmée). Si
 * l'organisation en a activé un, il s'applique par véhicule (an ou
 * semestre) dans l'ordre chronologique : les litres au-delà restent
 * visibles mais ne comptent pas dans le montant.
 */

import {
  montantRemboursement,
  tauxApplicable,
  type CategorieTicpe,
  type LigneBareme,
  type SurchargeBareme,
  type ZoneTicpe,
} from "@/lib/ticpe/bareme";
import { compteLe, type ResultatEligibilite } from "@/lib/ticpe/eligibilite";
import type { ReglagesTicpe } from "@/lib/ticpe/reglages";

export interface PleinTicpe {
  id: string;
  vehicle_id: string;
  occurred_at: string;
  liters: number | string | null;
  status: string;
  product?: string | null;
  station_name?: string | null;
  tank_id?: string | null;
  ticket_photo_path?: string | null;
  ticpe_justificatif?: string | null;
  ticpe_justificatif_ref?: string | null;
  /** Une personne a confirmé « deux pleins distincts » (migration 20261101000003). */
  ticpe_doublon_leve_le?: string | null;
}

/** Jour calendaire de Paris (AAAA-MM-JJ) d'un instant ISO. */
export function jourParis(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Corse : nom ou adresse de station (villes principales, « Corse », codes postaux 20xxx, 2A / 2B). */
const RE_CORSE =
  /\bcorse\b|\bcorsica\b|ajaccio|bastia|porto[- ]?vecchio|\bcalvi\b|\bcorte\b|propriano|bonifacio|[iî]le[- ]rousse|sart[eè]ne|ghisonaccia|biguglia|furiani|borgo\b|lucciana|\b20[0-6]\d{2}\b|\b2[ab]\b/i;

export function stationEnCorse(texte: string | null | undefined): boolean {
  return Boolean(texte && RE_CORSE.test(texte));
}

export type OrigineZone = "cuve" | "station" | "defaut";

/**
 * Zone d'un plein : cuve → zone de la cuve ; station dont le nom ou
 * l'adresse indique la Corse → Corse ; sinon zone par défaut de
 * l'organisation.
 */
export function zoneDuPlein(
  plein: Pick<PleinTicpe, "tank_id" | "station_name">,
  ctx: { zoneCuve?: "metropole" | "corse" | null; zoneParDefaut: "metropole" | "corse" },
): { zone: ZoneTicpe; origine: OrigineZone } {
  if (plein.tank_id) return { zone: ctx.zoneCuve ?? ctx.zoneParDefaut, origine: ctx.zoneCuve ? "cuve" : "defaut" };
  if (stationEnCorse(plein.station_name)) return { zone: "corse", origine: "station" };
  return { zone: ctx.zoneParDefaut, origine: "defaut" };
}

export type TypeJustificatif = "ticket" | "facture" | "releve_carte" | "livraison_cuve";

export const LIBELLES_JUSTIFICATIF: Record<TypeJustificatif, string> = {
  ticket: "Ticket de station (photo)",
  facture: "Facture carburant",
  releve_carte: "Relevé de carte carburant",
  livraison_cuve: "Facture de livraison de la cuve",
};

export interface Justificatif {
  type: TypeJustificatif | null;
  present: boolean;
  libelle: string;
}

/**
 * Justificatif à conserver pour un plein (jamais joint à la déclaration) :
 * photo du ticket ; sinon relevé de carte / facture déclaré sur le plein ;
 * pour la cuve, factures de livraison de la cuve.
 */
export function justificatifDuPlein(plein: PleinTicpe, ctx: { cuveAvecFacture: boolean }): Justificatif {
  if (plein.ticket_photo_path) return { type: "ticket", present: true, libelle: LIBELLES_JUSTIFICATIF.ticket };
  const declare = plein.ticpe_justificatif as TypeJustificatif | null | undefined;
  if (declare && declare in LIBELLES_JUSTIFICATIF && declare !== "ticket") {
    return { type: declare, present: true, libelle: `${LIBELLES_JUSTIFICATIF[declare]}${plein.ticpe_justificatif_ref ? ` n° ${plein.ticpe_justificatif_ref}` : ""}` };
  }
  if (plein.tank_id) {
    return ctx.cuveAvecFacture
      ? { type: "livraison_cuve", present: true, libelle: LIBELLES_JUSTIFICATIF.livraison_cuve }
      : { type: "livraison_cuve", present: false, libelle: "Aucune facture de livraison enregistrée pour la cuve" };
  }
  return { type: null, present: false, libelle: "Aucun justificatif (ticket, facture ou relevé de carte)" };
}

export type StatutLigne = "compte" | "exclu" | "taux_manquant";

export interface LigneTicpe {
  id: string;
  vehicle_id: string;
  occurred_at: string;
  /** Jour de Paris (AAAA-MM-JJ). */
  jour: string;
  litres: number;
  statut: StatutLigne;
  raison: string | null;
  categorie: CategorieTicpe | null;
  zone: ZoneTicpe | null;
  origineZone: OrigineZone | null;
  taux: number | null;
  tauxAConfirmer: boolean;
  origineTaux: "bareme" | "surcharge" | null;
  /** Litres retenus après plafond (= litres tant que le plafond n'est pas atteint). */
  litresRetenus: number;
  litresHorsPlafond: number;
  montant: number;
  justificatif: Justificatif;
  /** Écartée du montant : doublon probable, pas encore levé par une personne. */
  doublon?: boolean;
}

export interface ContextePlein {
  eligibilite: ResultatEligibilite | null;
  reglages: ReglagesTicpe;
  bareme: readonly LigneBareme[];
  surcharges: readonly SurchargeBareme[];
  zoneCuve?: "metropole" | "corse" | null;
  cuveAvecFacture?: boolean;
}

const STATUTS_FIABLES = ["manual", "validated"];

function nombre(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Montant TICPE d'un plein, avant plafond. */
export function calculerPlein(plein: PleinTicpe, ctx: ContextePlein): LigneTicpe {
  const jour = jourParis(plein.occurred_at);
  const litres = Math.max(0, nombre(plein.liters) ?? 0);
  const justificatif = justificatifDuPlein(plein, { cuveAvecFacture: Boolean(ctx.cuveAvecFacture) });
  const base: LigneTicpe = {
    id: plein.id,
    vehicle_id: plein.vehicle_id,
    occurred_at: plein.occurred_at,
    jour,
    litres,
    statut: "exclu",
    raison: null,
    categorie: ctx.eligibilite?.categorie ?? null,
    zone: null,
    origineZone: null,
    taux: null,
    tauxAConfirmer: false,
    origineTaux: null,
    litresRetenus: 0,
    litresHorsPlafond: 0,
    montant: 0,
    justificatif,
  };
  const exclu = (raison: string): LigneTicpe => ({ ...base, raison });

  if ((plein.product ?? "gazole") !== "gazole") return exclu("AdBlue : jamais remboursé.");
  if (!STATUTS_FIABLES.includes(plein.status)) return exclu("Plein non validé.");
  if (litres <= 0) return exclu("Litres non renseignés.");
  if (!ctx.eligibilite) return exclu("Véhicule introuvable.");
  if (ctx.eligibilite.statut === "exclu") {
    return exclu(`Véhicule exclu : ${ctx.eligibilite.raisons.find((r) => r.gravite === "exclu")?.libelle ?? "non éligible"}`);
  }
  if (!compteLe(ctx.eligibilite, jour)) return exclu("Plein hors de la période d'éligibilité du véhicule.");
  const categorie = ctx.eligibilite.categorie!;

  const { zone, origine } = zoneDuPlein(plein, { zoneCuve: ctx.zoneCuve ?? null, zoneParDefaut: ctx.reglages.zone_par_defaut });
  const t = tauxApplicable(jour, categorie, zone, ctx.bareme, ctx.surcharges, { forfaitPondere: ctx.reglages.forfait_pondere_2025 });
  if (t.statut === "manquant") return { ...base, categorie, zone, origineZone: origine, statut: "taux_manquant", raison: t.raison, litresRetenus: litres };
  return {
    ...base,
    categorie,
    zone: t.zoneRetenue,
    origineZone: origine,
    statut: "compte",
    taux: t.taux,
    tauxAConfirmer: t.aConfirmer,
    origineTaux: t.origine,
    litresRetenus: litres,
    montant: montantRemboursement(litres, t.taux),
  };
}

/** Clé de la période de plafond d'un jour : « 2026 » (an) ou « 2026-S1 » / « 2026-S2 » (semestre). */
export function clePeriodePlafond(jour: string, periode: "annuel" | "semestriel"): string {
  const annee = jour.slice(0, 4);
  if (periode === "annuel") return annee;
  return `${annee}-S${Number(jour.slice(5, 7)) <= 6 ? 1 : 2}`;
}

export interface Depassement {
  vehicle_id: string;
  periode: string;
  plafond: number;
  litres: number;
  litresHorsPlafond: number;
}

/**
 * Applique le plafond par véhicule et par période, dans l'ordre
 * chronologique des pleins comptés (et « taux manquant », qui consomment
 * aussi du volume). Renvoie de nouvelles lignes et les dépassements.
 */
export function appliquerPlafond(lignes: readonly LigneTicpe[], plafond: number | null, periode: "annuel" | "semestriel"): { lignes: LigneTicpe[]; depassements: Depassement[] } {
  // Pas de plafond activé : aucun litre n'est écarté.
  if (plafond === null) return { lignes: [...lignes], depassements: [] };
  const cumuls = new Map<string, number>();
  const hors = new Map<string, number>();
  const ordre = [...lignes].map((l, i) => ({ l, i })).sort((a, b) => Date.parse(a.l.occurred_at) - Date.parse(b.l.occurred_at) || a.l.id.localeCompare(b.l.id));
  const res: LigneTicpe[] = new Array(lignes.length);
  for (const { l, i } of ordre) {
    if (l.statut === "exclu") {
      res[i] = l;
      continue;
    }
    const cle = `${l.vehicle_id}|${clePeriodePlafond(l.jour, periode)}`;
    const deja = cumuls.get(cle) ?? 0;
    const reste = Math.max(0, plafond - deja);
    const retenus = Math.round(Math.min(reste, l.litres) * 100) / 100;
    const horsPlafond = Math.round((l.litres - retenus) * 100) / 100;
    cumuls.set(cle, deja + l.litres);
    if (horsPlafond > 0) hors.set(cle, (hors.get(cle) ?? 0) + horsPlafond);
    res[i] = {
      ...l,
      litresRetenus: retenus,
      litresHorsPlafond: horsPlafond,
      montant: l.statut === "compte" && l.taux !== null ? montantRemboursement(retenus, l.taux) : 0,
    };
  }
  const depassements: Depassement[] = [...hors.entries()].map(([cle, h]) => {
    const [vehicle_id, per] = cle.split("|") as [string, string];
    return { vehicle_id, periode: per, plafond, litres: Math.round((cumuls.get(cle) ?? 0) * 100) / 100, litresHorsPlafond: Math.round(h * 100) / 100 };
  });
  return { lignes: res, depassements };
}

export interface Totaux {
  pleins: number;
  litres: number;
  litresRetenus: number;
  litresHorsPlafond: number;
  montant: number;
  tauxManquants: number;
}

export function totaliser(lignes: readonly LigneTicpe[]): Totaux {
  const t: Totaux = { pleins: 0, litres: 0, litresRetenus: 0, litresHorsPlafond: 0, montant: 0, tauxManquants: 0 };
  for (const l of lignes) {
    if (l.statut === "exclu") continue;
    t.pleins += 1;
    t.litres += l.litres;
    t.litresRetenus += l.litresRetenus;
    t.litresHorsPlafond += l.litresHorsPlafond;
    t.montant += l.montant;
    if (l.statut === "taux_manquant") t.tauxManquants += 1;
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { ...t, litres: r2(t.litres), litresRetenus: r2(t.litresRetenus), litresHorsPlafond: r2(t.litresHorsPlafond), montant: r2(t.montant) };
}

/** Lignes d'une période [début, fin] (jours de Paris inclus). */
export function lignesDeLaPeriode<L extends { jour: string }>(lignes: readonly L[], debut: string, fin: string): L[] {
  return lignes.filter((l) => l.jour >= debut && l.jour <= fin);
}

/** Libellé court d'une ligne pour l'historique (« 12,45 € », « taux manquant », « exclu »). */
export function libelleLigne(l: LigneTicpe): string {
  if (l.statut === "exclu") return "non éligible";
  if (l.statut === "taux_manquant") return "taux manquant";
  return l.montant.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

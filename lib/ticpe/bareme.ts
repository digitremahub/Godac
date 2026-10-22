/**
 * Barème TICPE (remboursement partiel d'accise sur le gazole) — pur,
 * importable côté client et serveur, testé.
 *
 * Le barème est une table datée (ticpe_rates, migration
 * 20261031000001) maintenue par l'équipe GODAC ; une organisation peut
 * la surcharger pour un cas particulier (ticpe_rate_overrides, tracé).
 * Un taux inconnu (null) n'est JAMAIS remplacé par une valeur inventée :
 * le calcul renvoie « taux manquant ».
 */

export const CATEGORIES_TICPE = ["trm", "trv", "taxi"] as const;
export type CategorieTicpe = (typeof CATEGORIES_TICPE)[number];

export const LIBELLES_CATEGORIE: Record<CategorieTicpe, string> = {
  trm: "Transport routier de marchandises (PTAC ≥ 7,5 t)",
  trv: "Transport collectif de personnes (autocars)",
  taxi: "Taxi",
};

export const LIBELLES_CATEGORIE_COURTS: Record<CategorieTicpe, string> = {
  trm: "Marchandises",
  trv: "Voyageurs",
  taxi: "Taxi",
};

export const ZONES_TICPE = ["metropole", "corse", "ile_de_france", "auvergne_rhone_alpes", "forfait_pondere"] as const;
export type ZoneTicpe = (typeof ZONES_TICPE)[number];

export const LIBELLES_ZONE: Record<ZoneTicpe, string> = {
  metropole: "Métropole hors Corse",
  corse: "Corse",
  ile_de_france: "Île-de-France (≤ 2025)",
  auvergne_rhone_alpes: "Auvergne-Rhône-Alpes (≤ 2025)",
  forfait_pondere: "Forfaitaire pondéré (≤ 2025)",
};

/** Zones « régionales » de la métropole : sans ligne propre, on retombe sur le taux métropole. */
const SOUS_ZONES_METROPOLE: readonly ZoneTicpe[] = ["ile_de_france", "auvergne_rhone_alpes", "forfait_pondere"];

export interface LigneBareme {
  id?: string;
  categorie: CategorieTicpe;
  zone: ZoneTicpe;
  /** AAAA-MM-JJ inclus. */
  date_debut: string;
  /** AAAA-MM-JJ inclus ; null = en cours. */
  date_fin: string | null;
  /** €/hl ; null = inconnu, à compléter. */
  taux_eur_hl: number | null;
  source?: string | null;
  source_url?: string | null;
  verifie_le?: string | null;
  a_confirmer?: boolean;
  note?: string | null;
}

export interface SurchargeBareme {
  id?: string;
  categorie: CategorieTicpe;
  zone: ZoneTicpe;
  date_debut: string;
  date_fin: string | null;
  taux_eur_hl: number;
  motif: string;
  revoked_at?: string | null;
}

const URL_SOURCE = "https://www.impots.gouv.fr/professionnel/questions/comment-obtenir-le-remboursement-partiel-de-laccise-sur-le-gazole";

/**
 * Copie du barème semé par la migration 20261031000001 : utilisée tant
 * que la table n'existe pas encore (migration non appliquée). La table,
 * une fois là, fait foi.
 */
export const BAREME_PAR_DEFAUT: readonly LigneBareme[] = [
  { categorie: "trm", zone: "metropole", date_debut: "2025-01-01", date_fin: "2025-12-31", taux_eur_hl: 15.56, source: "Taux 2025 (régions hors IDF et AURA)", source_url: URL_SOURCE, verifie_le: "2026-10-31", a_confirmer: true },
  { categorie: "trm", zone: "ile_de_france", date_debut: "2025-01-01", date_fin: "2025-12-31", taux_eur_hl: 17.45, source: "Taux 2025 Île-de-France", source_url: URL_SOURCE, verifie_le: "2026-10-31", a_confirmer: true },
  { categorie: "trm", zone: "auvergne_rhone_alpes", date_debut: "2025-01-01", date_fin: "2025-12-31", taux_eur_hl: 15.29, source: "Taux 2025 Auvergne-Rhône-Alpes", source_url: URL_SOURCE, verifie_le: "2026-10-31", a_confirmer: true },
  { categorie: "trm", zone: "forfait_pondere", date_debut: "2025-01-01", date_fin: "2025-12-31", taux_eur_hl: 15.71, source: "Taux forfaitaire pondéré 2025", source_url: URL_SOURCE, verifie_le: "2026-10-31", a_confirmer: true },
  { categorie: "trm", zone: "corse", date_debut: "2025-01-01", date_fin: "2025-12-31", taux_eur_hl: null, source: "À compléter", a_confirmer: true },
  { categorie: "trm", zone: "metropole", date_debut: "2026-01-01", date_fin: null, taux_eur_hl: 15.56, source: "Taux 2026 métropole hors Corse", source_url: URL_SOURCE, verifie_le: "2026-10-31", a_confirmer: true },
  { categorie: "trm", zone: "corse", date_debut: "2026-01-01", date_fin: null, taux_eur_hl: 14.21, source: "Taux 2026 Corse", source_url: URL_SOURCE, verifie_le: "2026-10-31", a_confirmer: true },
  { categorie: "trv", zone: "metropole", date_debut: "2025-01-01", date_fin: "2025-12-31", taux_eur_hl: null, source: "À compléter", a_confirmer: true },
  { categorie: "trv", zone: "corse", date_debut: "2025-01-01", date_fin: "2025-12-31", taux_eur_hl: null, source: "À compléter", a_confirmer: true },
  { categorie: "trv", zone: "metropole", date_debut: "2026-01-01", date_fin: null, taux_eur_hl: null, source: "À compléter", a_confirmer: true },
  { categorie: "trv", zone: "corse", date_debut: "2026-01-01", date_fin: null, taux_eur_hl: null, source: "À compléter", a_confirmer: true },
  { categorie: "taxi", zone: "metropole", date_debut: "2025-01-01", date_fin: "2025-12-31", taux_eur_hl: null, source: "À compléter", a_confirmer: true },
  { categorie: "taxi", zone: "corse", date_debut: "2025-01-01", date_fin: "2025-12-31", taux_eur_hl: null, source: "À compléter", a_confirmer: true },
  { categorie: "taxi", zone: "metropole", date_debut: "2026-01-01", date_fin: null, taux_eur_hl: null, source: "À compléter", a_confirmer: true },
  { categorie: "taxi", zone: "corse", date_debut: "2026-01-01", date_fin: null, taux_eur_hl: null, source: "À compléter", a_confirmer: true },
];

export type ResultatTaux =
  | { statut: "ok"; taux: number; origine: "bareme" | "surcharge"; zoneRetenue: ZoneTicpe; ligne: LigneBareme | SurchargeBareme; aConfirmer: boolean }
  | { statut: "manquant"; raison: string; zoneRetenue: ZoneTicpe };

/** Date (AAAA-MM-JJ) dans la période [début, fin] (fin incluse, null = sans fin). */
export function dansPeriode(date: string, debut: string, fin: string | null): boolean {
  return date >= debut && (fin === null || date <= fin);
}

/** Ligne applicable la plus récente (début le plus tardif) pour une catégorie et une zone. */
function plusRecente<L extends { categorie: CategorieTicpe; zone: ZoneTicpe; date_debut: string; date_fin: string | null }>(
  lignes: readonly L[],
  date: string,
  categorie: CategorieTicpe,
  zone: ZoneTicpe,
): L | null {
  let meilleure: L | null = null;
  for (const l of lignes) {
    if (l.categorie !== categorie || l.zone !== zone || !dansPeriode(date, l.date_debut, l.date_fin)) continue;
    if (!meilleure || l.date_debut > meilleure.date_debut) meilleure = l;
  }
  return meilleure;
}

export interface OptionsTaux {
  /** 2025 : l'organisation a opté pour le taux forfaitaire pondéré (métropole hors Corse). */
  forfaitPondere?: boolean;
}

/**
 * Taux de remboursement (€/hl) applicable à une date, une catégorie et
 * une zone. Ordre :
 *  1. surcharge non révoquée de l'organisation (la plus récente) ;
 *  2. option « forfaitaire pondéré » (2025) pour la métropole hors Corse,
 *     si le barème en a une ligne à cette date ;
 *  3. ligne du barème de la zone exacte ;
 *  4. zone régionale sans ligne (IDF, AURA, forfait depuis 2026) →
 *     ligne « métropole » ; la Corse ne retombe jamais sur la métropole.
 * Un taux null dans le barème → « manquant », jamais une valeur inventée.
 */
export function tauxApplicable(
  date: string,
  categorie: CategorieTicpe,
  zone: ZoneTicpe,
  bareme: readonly LigneBareme[],
  surcharges: readonly SurchargeBareme[] = [],
  options: OptionsTaux = {},
): ResultatTaux {
  const jour = date.slice(0, 10);
  const actives = surcharges.filter((s) => !s.revoked_at);
  const surcharge = plusRecente(actives, jour, categorie, zone);
  if (surcharge) return { statut: "ok", taux: Number(surcharge.taux_eur_hl), origine: "surcharge", zoneRetenue: zone, ligne: surcharge, aConfirmer: false };

  const candidates: ZoneTicpe[] = [];
  if (options.forfaitPondere && zone !== "corse") candidates.push("forfait_pondere");
  candidates.push(zone);
  if (SOUS_ZONES_METROPOLE.includes(zone)) candidates.push("metropole");

  for (const z of candidates) {
    const sur = z === zone ? null : plusRecente(actives, jour, categorie, z);
    if (sur) return { statut: "ok", taux: Number(sur.taux_eur_hl), origine: "surcharge", zoneRetenue: z, ligne: sur, aConfirmer: false };
    const ligne = plusRecente(bareme, jour, categorie, z);
    if (!ligne) continue;
    if (ligne.taux_eur_hl === null || ligne.taux_eur_hl === undefined || !Number.isFinite(Number(ligne.taux_eur_hl))) {
      return { statut: "manquant", raison: `Taux ${LIBELLES_CATEGORIE_COURTS[categorie].toLowerCase()} · ${LIBELLES_ZONE[z]} non renseigné au ${formatJour(jour)}.`, zoneRetenue: z };
    }
    return { statut: "ok", taux: Number(ligne.taux_eur_hl), origine: "bareme", zoneRetenue: z, ligne, aConfirmer: Boolean(ligne.a_confirmer) };
  }
  return { statut: "manquant", raison: `Aucun taux ${LIBELLES_CATEGORIE_COURTS[categorie].toLowerCase()} · ${LIBELLES_ZONE[zone]} au barème au ${formatJour(jour)}.`, zoneRetenue: zone };
}

export function formatJour(jour: string): string {
  const [y, m, d] = jour.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** Montant remboursable d'un volume : litres / 100 × taux €/hl, arrondi au centime. */
export function montantRemboursement(litres: number, tauxEurHl: number): number {
  return Math.round(((litres / 100) * tauxEurHl + Number.EPSILON) * 100) / 100;
}

/** Lignes du barème qui se chevauchent (même catégorie et zone) — contrôle de saisie staff. */
export function chevauchements(lignes: readonly LigneBareme[]): [LigneBareme, LigneBareme][] {
  const res: [LigneBareme, LigneBareme][] = [];
  for (let i = 0; i < lignes.length; i++) {
    for (let j = i + 1; j < lignes.length; j++) {
      const a = lignes[i]!;
      const b = lignes[j]!;
      if (a.categorie !== b.categorie || a.zone !== b.zone) continue;
      const finA = a.date_fin ?? "9999-12-31";
      const finB = b.date_fin ?? "9999-12-31";
      if (a.date_debut <= finB && b.date_debut <= finA) res.push([a, b]);
    }
  }
  return res;
}

/** Normalise une ligne lue en base (numeric → number). */
export function normaliserLigne<T extends { taux_eur_hl: unknown }>(l: T): T & { taux_eur_hl: number | null } {
  const t = l.taux_eur_hl === null || l.taux_eur_hl === undefined || l.taux_eur_hl === "" ? null : Number(l.taux_eur_hl);
  return { ...l, taux_eur_hl: t !== null && Number.isFinite(t) ? t : null };
}

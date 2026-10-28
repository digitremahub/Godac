import { alertesAClore } from "@/lib/alerts/cloture";
import { formaterQuantite, type ArticleSousSeuil } from "@/lib/stock/soldes";

/**
 * Alertes du module Stock (fichier pur, testé dans lib/stock/__tests__/alertes.test.ts).
 * Trois types additifs de l'enum alert_type (migration 20261114000003) :
 *   stock_seuil       article sous son seuil mini (une alerte par article tant qu'il l'est)
 *   stock_ecart       inventaire validé avec des écarts
 *   stock_non_rentre  unités chargées en tournée non rentrées après la clôture
 *   stock_dlc_proche  lot ou unités dont la date limite approche (J-n selon la règle du profil)
 * Lecture : direction, exploitation, manager de l'alerte ayant son service ; jamais
 * chauffeur ni comptable (lib/alerts/destinataires.ts).
 */

export const TYPES_ALERTE_STOCK = ["stock_seuil", "stock_ecart", "stock_non_rentre", "stock_dlc_proche"] as const;
export type TypeAlerteStock = (typeof TYPES_ALERTE_STOCK)[number];

/** Rôles destinataires (e-mail, push) ; le manager reçoit celles de son service. */
export const ROLES_DESTINATAIRES_STOCK = ["direction", "exploitation", "manager"] as const;

export const cleAlerteSeuil = (articleId: string) => `stock:seuil:${articleId}`;
export const cleAlerteEcart = (inventaireId: string) => `stock:ecart:${inventaireId}`;
export const cleAlerteNonRentre = (runId: string) => `stock:non_rentre:${runId}`;

export const cleAlerteDlc = (articleId: string, lot: string) => `stock:dlc:${articleId}:${lot || "-"}`;
export const CLE_ALERTE_DLC_UNITES = "stock:dlc:unites";

export function messageSeuil(x: ArticleSousSeuil): string {
  const { article, quantite } = x;
  return `Stock sous le seuil : ${article.nom} (${article.code}), ${formaterQuantite(quantite)} en stock pour un minimum de ${formaterQuantite(article.seuil_mini)} ${article.unite}.`;
}

export function messageEcart(site: string, phrase: string): string {
  return `Inventaire validé au dépôt « ${site} » : ${phrase}`;
}

export function messageNonRentre(nombre: number, tournee: string): string {
  return `${nombre} unité${nombre > 1 ? "s" : ""} chargée${nombre > 1 ? "s" : ""} en tournée ${tournee} ${nombre > 1 ? "ne sont" : "n'est"} pas rentrée${nombre > 1 ? "s" : ""} au dépôt après la clôture.`;
}

export interface AlerteStockOuverte {
  id: string;
  type: string;
  related_id: string | null;
  cle_dedoublonnage?: string | null;
}

/**
 * Décision pour le seuil : articles à signaler (sous le seuil, sans alerte ouverte)
 * et alertes à clore (article revenu au-dessus du seuil, désactivé ou sans seuil).
 */
export function decisionsSeuil(sousSeuil: readonly ArticleSousSeuil[], ouvertes: readonly AlerteStockOuverte[]): { aSignaler: ArticleSousSeuil[]; aClore: string[] } {
  const seuil = ouvertes.filter((a) => a.type === "stock_seuil");
  const dejaSignales = new Set(seuil.map((a) => a.related_id));
  const encoreSous = new Set(sousSeuil.map((x) => x.article.id));
  return {
    aSignaler: sousSeuil.filter((x) => !dejaSignales.has(x.article.id)),
    aClore: alertesAClore(seuil, new Map([["stock_seuil", encoreSous]])),
  };
}

export interface TourneeNonRentree {
  run_id: string;
  nombre: number;
  libelle: string;
  service_id: string | null;
}

/** Décision pour les unités non rentrées : tournées à signaler et alertes à clore (tout est rentré). */
export function decisionsNonRentre(tournees: readonly TourneeNonRentree[], ouvertes: readonly AlerteStockOuverte[]): { aSignaler: TourneeNonRentree[]; aClore: string[] } {
  const nr = ouvertes.filter((a) => a.type === "stock_non_rentre");
  const dejaSignalees = new Set(nr.map((a) => a.related_id));
  const encore = new Set(tournees.map((t) => t.run_id));
  return {
    aSignaler: tournees.filter((t) => !dejaSignalees.has(t.run_id)),
    aClore: alertesAClore(nr, new Map([["stock_non_rentre", encore]])),
  };
}

/** Regroupe des unités (en tournée ou en retour, d'une tournée clôturée) par tournée. */
export function grouperNonRentrees(
  unites: readonly { run_id: string | null }[],
  tournees: ReadonlyMap<string, { libelle: string; service_id: string | null; cloturee: boolean }>,
): TourneeNonRentree[] {
  const compte = new Map<string, number>();
  for (const u of unites) if (u.run_id) compte.set(u.run_id, (compte.get(u.run_id) ?? 0) + 1);
  const res: TourneeNonRentree[] = [];
  for (const [run_id, nombre] of compte) {
    const t = tournees.get(run_id);
    if (t?.cloturee) res.push({ run_id, nombre, libelle: t.libelle, service_id: t.service_id });
  }
  return res.sort((a, b) => b.nombre - a.nombre || a.libelle.localeCompare(b.libelle, "fr"));
}

// ── DLC proche ─────────────────────────────────────────────────────────

export interface LotDlcProche {
  article: { id: string; code: string; nom: string };
  lot: string;
  dlc: string;
  /** Jours restants (négatif : dépassée). */
  jours: number;
  quantite: number;
  unite: string;
}

export function messageDlcLot(x: LotDlcProche): string {
  const date = x.dlc.split("-").reverse().join("/");
  const quand = x.jours < 0 ? `dépassée depuis ${-x.jours} jour${-x.jours > 1 ? "s" : ""}` : x.jours === 0 ? "aujourd'hui" : `dans ${x.jours} jour${x.jours > 1 ? "s" : ""}`;
  return `DLC ${x.jours < 0 ? "dépassée" : "proche"} : ${x.article.nom} (${x.article.code})${x.lot ? `, lot ${x.lot}` : ""}, ${formaterQuantite(x.quantite)} ${x.unite}, date limite ${date} (${quand}).`;
}

export function messageDlcUnites(nombre: number, jours: number): string {
  return `${nombre} unité${nombre > 1 ? "s" : ""} en stock ${nombre > 1 ? "ont" : "a"} une date limite dans les ${jours} prochains jours (ou dépassée).`;
}

/** Décision pour la DLC : lots à signaler et alertes à clore (lot épuisé, DLC changée ou hors délai), par clé de dédoublonnage. */
export function decisionsDlc<T extends { cle: string }>(lots: readonly T[], ouvertes: readonly AlerteStockOuverte[]): { aSignaler: T[]; aClore: string[] } {
  const dlc = ouvertes.filter((a) => a.type === "stock_dlc_proche");
  const dejaSignalees = new Set(dlc.map((a) => a.cle_dedoublonnage));
  const encore = new Set(lots.map((l) => l.cle));
  return {
    aSignaler: lots.filter((l) => !dejaSignalees.has(l.cle)),
    aClore: dlc.filter((a) => a.cle_dedoublonnage && !encore.has(a.cle_dedoublonnage)).map((a) => a.id),
  };
}

/**
 * Export comptable des pleins (CSV pour Excel France, ou classeur Excel) :
 * filtres période / véhicule / chauffeur / statut, totaux (litres, montant
 * HT et TTC, TVA). Fichier pur (aucune dépendance serveur), testé dans
 * lib/fuel/__tests__/export.test.ts ; la lecture est faite par
 * app/api/fuel-entries/export, le classeur par lib/fuel/export-excel.ts.
 *
 * Périmètre strictement celui du rôle : comptable, direction et exploitation
 * toute l'organisation, manager son service (sous la RLS de fuel_entries) ;
 * chauffeur : aucun export. Le CSV suit celui des tournées
 * (lib/paie/csv.ts) : UTF-8 avec BOM, « ; », CRLF, décimales à la virgule,
 * neutralisation de l'injection de formule.
 */
import { documentCsv, nombreFr } from "@/lib/paie/csv";
import { MENTION_INDICATIVE } from "@/lib/legal/mention-indicative";

/** Rôles qui exportent les pleins ; le manager est borné à son service par la RLS. */
export const ROLES_EXPORT_PLEINS = ["comptable", "direction", "exploitation", "manager"] as const;

export type PerimetreExportPleins = "organisation" | "service";

export function perimetreExportPleins(role: string): PerimetreExportPleins | null {
  if (role === "comptable" || role === "direction" || role === "exploitation") return "organisation";
  if (role === "manager") return "service";
  return null;
}

/** Nombre maximal de pleins d'un export : au-delà, le fichier est tronqué et le dit. */
export const EXPORT_MAX_PLEINS = 5000;

/**
 * Taux de TVA appliqué au montant TTC enregistré pour en déduire le HT et la
 * TVA (carburant en France, 20 %). Le montant d'un plein est celui du ticket,
 * donc TTC. À confirmer avec le comptable : l'export l'indique en tête et ne le
 * décline pas par produit, ni par taux réellement facturé.
 */
export const TAUX_TVA_CARBURANT = 0.2;

const arrondi = (n: number) => Math.round(n * 100) / 100;

/** HT et TVA déduits d'un montant TTC. */
export function ventilerTva(ttc: number, taux: number = TAUX_TVA_CARBURANT): { ht: number; tva: number } {
  const ht = arrondi(ttc / (1 + taux));
  return { ht, tva: arrondi(ttc - ht) };
}

export const STATUTS_FILTRE = ["enregistres", "tous", "manual", "validated", "awaiting_validation", "pending_ocr", "ocr_failed"] as const;
export type StatutFiltre = (typeof STATUTS_FILTRE)[number];

export const LIBELLES_STATUT_EXPORT: Readonly<Record<string, string>> = {
  manual: "Saisi à la main",
  validated: "Ticket validé",
  awaiting_validation: "Ticket à valider",
  pending_ocr: "Ticket en cours de lecture",
  ocr_failed: "Lecture du ticket échouée",
};

/** Statuts retenus par défaut : les pleins enregistrés (ceux qui comptent en comptabilité). */
export const STATUTS_ENREGISTRES = ["manual", "validated"] as const;

/** Statuts à lire pour ce filtre ; null : tous. */
export function statutsDuFiltre(statut: StatutFiltre): readonly string[] | null {
  if (statut === "tous") return null;
  if (statut === "enregistres") return STATUTS_ENREGISTRES;
  return [statut];
}

export interface FiltresExportPleins {
  /** AAAA-MM-JJ (Paris), inclus. */
  du: string;
  au: string;
  vehicule: string | null;
  chauffeur: string | null;
  statut: StatutFiltre;
}

const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Filtres de la requête : valeurs invalides ignorées ; période par défaut = mois en cours jusqu'à aujourd'hui (jours de Paris). */
export function lireFiltresExportPleins(params: Record<string, string | undefined>, aujourdhui: string): FiltresExportPleins {
  const debutMois = `${aujourdhui.slice(0, 7)}-01`;
  let du = params.du && JOUR.test(params.du) ? params.du : debutMois;
  let au = params.au && JOUR.test(params.au) ? params.au : aujourdhui;
  if (du > au) [du, au] = [au, du];
  const statut = (STATUTS_FILTRE as readonly string[]).includes(params.statut ?? "") ? (params.statut as StatutFiltre) : "enregistres";
  return {
    du,
    au,
    vehicule: params.vehicule && UUID.test(params.vehicule) ? params.vehicule : null,
    chauffeur: params.chauffeur && UUID.test(params.chauffeur) ? params.chauffeur : null,
    statut,
  };
}

export type FormatExportPleins = "csv" | "xlsx";
export const FORMATS_EXPORT_PLEINS: readonly FormatExportPleins[] = ["csv", "xlsx"];

export interface LignePleinExport {
  /** AAAA-MM-JJ (Paris) */
  date: string;
  /** HH:MM (Paris) */
  heure: string;
  vehicule: string;
  chauffeur: string;
  produit: string;
  /** « Cuve X » ou « Station Y » */
  origine: string;
  litres: number | null;
  prixLitre: number | null;
  ttc: number | null;
  ht: number | null;
  tva: number | null;
  km: number | null;
  statut: string;
  justificatif: string;
}

export const ENTETE_PLEINS_EXPORT = [
  "Date",
  "Heure",
  "Véhicule",
  "Chauffeur",
  "Produit",
  "Origine",
  "Litres",
  "Prix au litre TTC (€)",
  "Montant TTC (€)",
  "Montant HT (€)",
  "TVA (€)",
  "Kilométrage",
  "Statut",
  "Justificatif",
] as const;

export interface PleinBrut {
  occurred_at: string;
  liters: number | string | null;
  unit_price: number | string | null;
  total_amount: number | string | null;
  vehicle_km: number | string | null;
  product: string | null;
  status: string;
  station_name: string | null;
  tank_id: string | null;
  ticket_photo_path: string | null;
  ticpe_justificatif?: string | null;
  vehicule: string | null;
  chauffeur: string | null;
  cuve: string | null;
}

const nombre = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const jourHeure = (iso: string) => {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return { date: `${p("year")}-${p("month")}-${p("day")}`, heure: `${p("hour")}:${p("minute")}` };
};

export function justificatifExport(p: Pick<PleinBrut, "ticket_photo_path" | "ticpe_justificatif">): string {
  if (p.ticket_photo_path) return "Photo du ticket";
  if (p.ticpe_justificatif === "releve_carte") return "Relevé de carte";
  if (p.ticpe_justificatif === "facture") return "Facture";
  return "Aucun";
}

export function lignePleinExport(p: PleinBrut): LignePleinExport {
  const { date, heure } = jourHeure(p.occurred_at);
  const ttc = nombre(p.total_amount);
  const tva = ttc === null ? null : ventilerTva(ttc);
  return {
    date,
    heure,
    vehicule: p.vehicule ?? "",
    chauffeur: p.chauffeur ?? "",
    produit: p.product === "adblue" ? "AdBlue" : "Gazole",
    origine: p.cuve ? `Cuve ${p.cuve}` : p.tank_id ? "Cuve" : p.station_name ? `Station ${p.station_name}` : "Station",
    litres: nombre(p.liters),
    prixLitre: nombre(p.unit_price),
    ttc,
    ht: tva?.ht ?? null,
    tva: tva?.tva ?? null,
    km: nombre(p.vehicle_km),
    statut: LIBELLES_STATUT_EXPORT[p.status] ?? p.status,
    justificatif: justificatifExport(p),
  };
}

export interface TotauxPleins {
  nombre: number;
  litres: number;
  ttc: number;
  ht: number;
  tva: number;
}

/** Totaux d'une liste de lignes ; le HT et la TVA sont recalculés ligne à ligne (somme des arrondis, comme les lignes affichées). */
export function totauxPleins(lignes: readonly LignePleinExport[]): TotauxPleins {
  const somme = (f: (l: LignePleinExport) => number | null) => arrondi(lignes.reduce((n, l) => n + (f(l) ?? 0), 0));
  return { nombre: lignes.length, litres: somme((l) => l.litres), ttc: somme((l) => l.ttc), ht: somme((l) => l.ht), tva: somme((l) => l.tva) };
}

/** Totaux par produit (gazole, AdBlue) : les litres des deux ne s'additionnent pas. */
export function totauxParProduit(lignes: readonly LignePleinExport[]): { produit: string; totaux: TotauxPleins }[] {
  const produits = [...new Set(lignes.map((l) => l.produit))].sort();
  return produits.map((produit) => ({ produit, totaux: totauxPleins(lignes.filter((l) => l.produit === produit)) }));
}

/** Phrase de troncature (CSV, en-têtes HTTP, classeur). */
export function avertissementTroncature(max: number = EXPORT_MAX_PLEINS): string {
  return `Export tronqué : seuls les ${max.toLocaleString("fr-FR")} premiers pleins de la période sont inclus. Réduisez la période ou filtrez par véhicule ou chauffeur.`;
}

/** Mention sur la TVA, reprise dans le CSV et le classeur. */
export function mentionTva(taux: number = TAUX_TVA_CARBURANT): string {
  return `Montants TTC = montants des tickets ; HT et TVA déduits au taux de ${(taux * 100).toLocaleString("fr-FR")} % (à confirmer avec votre comptable).`;
}

/**
 * Document CSV : en-tête, un plein par ligne, ligne de totaux (et un total par
 * produit s'il y en a plusieurs), mention TVA, avertissement de troncature.
 */
export function csvPleins(lignes: readonly LignePleinExport[], options: { tronque?: boolean } = {}): string {
  const cellules = lignes.map((l) => [l.date, l.heure, l.vehicule, l.chauffeur, l.produit, l.origine, l.litres, l.prixLitre, l.ttc, l.ht, l.tva, l.km, l.statut, l.justificatif]);
  const ligneTotal = (libelle: string, t: TotauxPleins) => [libelle, "", "", "", "", `${t.nombre} plein${t.nombre > 1 ? "s" : ""}`, t.litres, "", t.ttc, t.ht, t.tva, "", "", ""];
  const total = totauxPleins(lignes);
  const parProduit = totauxParProduit(lignes);
  const pied: (string | number | null)[][] = [["", "", "", "", "", "", "", "", "", "", "", "", "", ""], ligneTotal("TOTAL", total)];
  if (parProduit.length > 1) for (const p of parProduit) pied.push(ligneTotal(`Total ${p.produit}`, p.totaux));
  pied.push([mentionTva()]);
  pied.push([MENTION_INDICATIVE]);
  if (options.tronque) pied.push([avertissementTroncature()]);
  return documentCsv(ENTETE_PLEINS_EXPORT, [...cellules, ...pied]);
}

export function nomFichierPleins(du: string, au: string, format: FormatExportPleins): string {
  return `pleins-${du}-${au}.${format}`;
}

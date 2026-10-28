import { documentCsv } from "@/lib/paie/csv";
import { NATURES, TEMPERATURES, libelleNature, libelleTemperature, type AttributsLus, type Nature, type Temperature } from "@/lib/stock/attributs";
import { LIBELLES_STATUT, estStatutUnite, type StatutUnite } from "@/lib/stock/transitions";
import { LIBELLES_TYPES_UNITE, type TypeUnite } from "@/lib/stock/profils";

/**
 * Recherche et export des unités (fichier pur, testé dans lib/stock/__tests__/unites.test.ts).
 * Les filtres couvrent le code principal ET le code interne complémentaire, ainsi que les
 * attributs (nature, température, urgent, fragile).
 */

export const PAR_PAGE_UNITES = 50;
export const EXPORT_MAX_UNITES = 10000;
export const FORMATS_EXPORT_UNITES = ["csv", "xlsx"] as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FiltresUnites {
  q: string | null;
  statut: StatutUnite | null;
  site: string | null;
  nature: Nature | null;
  temperature: Temperature | null;
  urgent: boolean;
  fragile: boolean;
  page: number;
}

export function lireFiltresUnites(p: Record<string, string | undefined>): FiltresUnites {
  const q = (p.q ?? "").replace(/[%_,()*]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  const page = Math.floor(Number(p.page ?? "1"));
  return {
    q: q || null,
    statut: p.statut && estStatutUnite(p.statut) ? p.statut : null,
    site: p.site && uuid.test(p.site) ? p.site : null,
    nature: p.nature && (NATURES as readonly string[]).includes(p.nature) ? (p.nature as Nature) : null,
    temperature: p.temperature && (TEMPERATURES as readonly string[]).includes(p.temperature) ? (p.temperature as Temperature) : null,
    urgent: p.urgent === "1",
    fragile: p.fragile === "1",
    page: Number.isFinite(page) && page >= 1 && page <= 10000 ? page : 1,
  };
}

/** Clause « ou » PostgREST de la recherche libre (le texte est déjà débarrassé de ses caractères spéciaux). */
export function clauseRecherche(q: string, avecCodes: boolean): string {
  const colonnes = avecCodes ? ["code", "code_interne", "sscc", "reference_client", "lot"] : ["code", "sscc"];
  return colonnes.map((c) => `${c}.ilike.%${q}%`).join(",");
}

export interface LigneUnite extends AttributsLus {
  code: string;
  code_interne: string | null;
  type_unite: TypeUnite;
  poids_kg: number | null;
  volume_m3: number | null;
  sscc: string | null;
  statut: string;
  profil: string | null;
}

export const ENTETE_EXPORT_UNITES = ["Code principal", "Code interne", "Type", "Nature", "Température", "Température relevée (°C)", "Fragile", "Urgent", "Consigne", "Référence client", "Lot", "DLC", "Poids (kg)", "Volume (m³)", "SSCC", "Statut", "Dépôt", "Emplacement"] as const;

export interface UniteExport extends LigneUnite {
  depot: string;
  emplacement: string;
}

export function cellulesUnite(u: UniteExport): (string | number)[] {
  return [
    u.code,
    u.code_interne ?? "",
    LIBELLES_TYPES_UNITE[u.type_unite] ?? u.type_unite,
    libelleNature(u.nature, u.nature_libelle),
    libelleTemperature(u.temperature, u.temperature_libelle),
    u.temperature_releve ?? "",
    u.fragile ? "oui" : "non",
    u.urgent ? "oui" : "non",
    u.consigne ?? "",
    u.reference_client ?? "",
    u.lot ?? "",
    u.dlc ? u.dlc.split("-").reverse().join("/") : "",
    u.poids_kg ?? "",
    u.volume_m3 ?? "",
    u.sscc ?? "",
    estStatutUnite(u.statut) ? LIBELLES_STATUT[u.statut] : u.statut,
    u.depot,
    u.emplacement,
  ];
}

export function csvUnites(lignes: readonly UniteExport[], options: { tronque?: boolean } = {}): string {
  const pied: (string | number)[][] = options.tronque ? [[`Export tronqué à ${EXPORT_MAX_UNITES} lignes : affinez la recherche.`]] : [];
  return documentCsv(ENTETE_EXPORT_UNITES, [...lignes.map(cellulesUnite), ...pied]);
}

export const nomFichierUnites = (format: (typeof FORMATS_EXPORT_UNITES)[number]) => `unites-stock.${format}`;

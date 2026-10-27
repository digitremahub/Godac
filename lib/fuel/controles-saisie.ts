/**
 * Contrôles de cohérence à la saisie d'un plein (capacité du réservoir,
 * kilométrage), communs à la création (POST /api/fuel-entries) et à la
 * validation ou correction d'un plein existant (PATCH /api/fuel-entries/[id],
 * parcours ticket OCR).
 *
 * Un contrôle qui échoue ne fait plus perdre la saisie : l'API répond
 * « à confirmer » (code CONTROLE_A_CONFIRMER) avec la liste des contrôles ;
 * le chauffeur peut confirmer en précisant un motif court, le plein est alors
 * enregistré avec `controle_confirme` et l'écart remonte dans « À traiter »
 * (lib/fuel/ecarts.ts, code « controle_confirme »). La date dans le futur reste
 * un refus : ce n'est pas un écart, c'est une erreur de saisie.
 *
 * Fichier pur (aucune dépendance serveur) : testé dans
 * lib/fuel/__tests__/controles-saisie.test.ts.
 */
import { checkOdometerJump, checkOdometerNotRegressing } from "@/lib/business/odometer";

/** Tolérance au-delà de la capacité du réservoir (jauge, mousse). */
export const MARGE_RESERVOIR = 1.1;

/** Motif de confirmation : court, mais jamais vide. */
export const MOTIF_MIN = 3;
export const MOTIF_MAX = 300;

/** Code renvoyé par l'API quand des contrôles attendent une confirmation. */
export const CODE_CONTROLE_A_CONFIRMER = "CONTROLE_A_CONFIRMER";

export type CodeControleSaisie = "capacite_reservoir" | "km_recul" | "km_apres_releve" | "km_saut";

export interface ControleSaisie {
  code: CodeControleSaisie;
  message: string;
}

export interface ReleveKm {
  km: number;
  at: string;
  source: string;
}

/** Litres plausibles pour le réservoir du véhicule (capacité × 1,1) ; null : capacité inconnue ou litres plausibles. */
export function controleCapacite(params: { liters: number; product: "gazole" | "adblue"; capaciteLitres: number | null | undefined }): ControleSaisie | null {
  const capacite = Number(params.capaciteLitres) || null;
  if (!capacite || params.liters <= capacite * MARGE_RESERVOIR) return null;
  return {
    code: "capacite_reservoir",
    message: `${params.liters} L dépasse la capacité du réservoir ${params.product === "adblue" ? "AdBlue " : ""}du véhicule (${capacite} L).`,
  };
}

/**
 * Kilométrage ni en recul, ni au-dessus d'un relevé postérieur, ni en saut
 * absurde, comparé aux relevés connus à la date réelle du plein.
 */
export function controlesKilometrage(params: { km: number; occurredAt: string; avant: ReleveKm | null; apres: ReleveKm | null }): ControleSaisie[] {
  const { km, avant, apres } = params;
  const controles: ControleSaisie[] = [];
  const recul = checkOdometerNotRegressing(km, avant?.km ?? null, `la dernière lecture à cette date (${avant?.source ?? "véhicule"})`);
  if (!recul.ok) controles.push({ code: "km_recul", message: recul.message! });
  if (apres && km > apres.km) {
    const date = new Date(apres.at).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });
    controles.push({ code: "km_apres_releve", message: `${km} km dépasse un relevé postérieur au plein (${apres.km} km le ${date}, ${apres.source}).` });
  }
  const saut = checkOdometerJump(km, avant?.km ?? null, avant?.at ?? null, new Date(params.occurredAt));
  if (!saut.ok) controles.push({ code: "km_saut", message: saut.message! });
  return controles;
}

export function motifControleValide(motif: string | null | undefined): boolean {
  const m = (motif ?? "").trim();
  return m.length >= MOTIF_MIN && m.length <= MOTIF_MAX;
}

/** Phrase unique pour l'erreur HTTP (`error`) : lisible par les écrans qui n'affichent que ce champ. */
export function messageControles(controles: readonly ControleSaisie[]): string {
  return `${controles.map((c) => c.message).join(" ")} Vérifiez la saisie, ou confirmez avec un motif : l'écart sera signalé à l'encadrement.`;
}

/** Confirmation enregistrée dans fuel_entries.controle_confirme. */
export interface ControleConfirme {
  controles: ControleSaisie[];
  motif: string;
  par: string;
  le: string;
}

export function construireConfirmation(controles: readonly ControleSaisie[], motif: string, par: string, maintenant: Date = new Date()): ControleConfirme {
  return { controles: controles.map((c) => ({ code: c.code, message: c.message })), motif: motif.trim(), par, le: maintenant.toISOString() };
}

/** Lecture tolérante de la colonne (jsonb inconnu, ancien format) : null si elle n'a pas la forme attendue. */
export function lireControleConfirme(brut: unknown): ControleConfirme | null {
  if (!brut || typeof brut !== "object") return null;
  const b = brut as Record<string, unknown>;
  if (!Array.isArray(b.controles) || typeof b.motif !== "string") return null;
  const controles = b.controles.filter((c): c is ControleSaisie => !!c && typeof c === "object" && typeof (c as ControleSaisie).message === "string").map((c) => ({ code: c.code, message: c.message }));
  if (controles.length === 0) return null;
  return { controles, motif: b.motif, par: typeof b.par === "string" ? b.par : "", le: typeof b.le === "string" ? b.le : "" };
}

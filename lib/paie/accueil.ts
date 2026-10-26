/**
 * Paie sur les tableaux de bord : la prochaine action de chacun.
 * - direction : « Bulletins à valider : N » (décision client : la direction
 *   valide la paie), vers le mois le plus ancien qui attend ;
 * - comptable : bulletins du mois préparés, validés et refusés à corriger.
 * Fichier pur, testé dans lib/paie/__tests__.
 */
import { statutValide } from "@/lib/paie/validation";

export interface LigneBulletinAccueil {
  period_start: string;
  validation_status: string | null;
}

/** Bulletins en attente de la direction et mois le plus ancien concerné (AAAA-MM). */
export function bulletinsAValider(lignes: readonly LigneBulletinAccueil[]): { nombre: number; mois: string | null } {
  const enAttente = lignes.filter((l) => statutValide(l.validation_status) === "en_attente");
  const mois = enAttente.map((l) => l.period_start.slice(0, 7)).sort()[0] ?? null;
  return { nombre: enAttente.length, mois };
}

/** Bulletins en attente de validation, par mois (AAAA-MM), du plus ancien au plus récent. */
export function bulletinsAValiderParMois(lignes: readonly LigneBulletinAccueil[]): { mois: string; nombre: number }[] {
  const parMois = new Map<string, number>();
  for (const l of lignes) {
    if (statutValide(l.validation_status) !== "en_attente") continue;
    const mois = l.period_start.slice(0, 7);
    parMois.set(mois, (parMois.get(mois) ?? 0) + 1);
  }
  return [...parMois].map(([mois, nombre]) => ({ mois, nombre })).sort((a, b) => a.mois.localeCompare(b.mois));
}

/** Requête de la page Paie pour ouvrir un mois donné (vide : mois en cours). */
export function suiteMoisPaie(mois: string | null, moisCourant: string): string {
  return mois && mois !== moisCourant ? `?mois=${mois}` : "";
}

export interface ResumeBulletinsMois {
  prepares: number;
  valides: number;
  enAttente: number;
  refuses: number;
}

/** Bulletins d'un mois par statut de validation (accueil du comptable). */
export function resumeBulletinsMois(lignes: readonly LigneBulletinAccueil[]): ResumeBulletinsMois {
  const r: ResumeBulletinsMois = { prepares: lignes.length, valides: 0, enAttente: 0, refuses: 0 };
  for (const l of lignes) {
    const s = statutValide(l.validation_status);
    if (s === "valide") r.valides++;
    else if (s === "refuse") r.refuses++;
    else r.enAttente++;
  }
  return r;
}

/** « 12 préparés / 15 salariés · 2 refusés à corriger ». */
export function valeurBulletinsMois(r: ResumeBulletinsMois, salaries: number): string {
  const base = `${r.prepares} / ${salaries}`;
  return r.refuses > 0 ? `${base} · ${r.refuses} à corriger` : base;
}

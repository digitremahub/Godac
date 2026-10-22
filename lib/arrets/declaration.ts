import { addDays, parisCalendarDate } from "@/lib/planning/dates";
import type { TypeArret } from "@/lib/paie/types";

// Arrêts de travail déclarés par le salarié — logique pure (aucune
// dépendance serveur), importable côté client, testée dans
// lib/arrets/__tests__/declaration.test.ts.
//
// Aucune donnée médicale : type d'arrêt, dates, prolongation. Le volet 1
// de l'avis (éléments médicaux) n'est jamais demandé ni conservé.

/** Statut d'un arrêt (work_stoppages.status). Lignes saisies par la paie : « valide ». */
export type StatutArret = "recu" | "valide" | "refuse";

export const LIBELLE_STATUT_ARRET: Record<StatutArret, string> = {
  recu: "Reçu, à vérifier",
  valide: "Validé",
  refuse: "Refusé",
};

/** Types qu'un salarié déclare (le congé sans solde se demande à la direction). */
export type TypeDeclarable = Exclude<TypeArret, "sans_solde">;

export const TYPES_DECLARABLES: { key: TypeDeclarable; label: string }[] = [
  { key: "maladie", label: "Maladie" },
  { key: "at_mp", label: "Accident du travail / maladie professionnelle" },
  { key: "trajet", label: "Accident de trajet" },
  { key: "maternite", label: "Maternité" },
  { key: "paternite", label: "Paternité / accueil de l'enfant" },
];

export function estTypeDeclarable(t: unknown): t is TypeDeclarable {
  return TYPES_DECLARABLES.some((x) => x.key === t);
}

/** Libellé court d'un type (sans solde compris, pour les lignes de la paie). */
export function libelleTypeArret(t: string): string {
  return TYPES_DECLARABLES.find((x) => x.key === t)?.label ?? (t === "sans_solde" ? "Congé sans solde" : t);
}

/** Délai légal d'envoi de l'avis d'arrêt à l'employeur (heures). */
export const DELAI_ENVOI_HEURES = 48;

/** Période d'arrêt, dates incluses (YYYY-MM-DD). */
export interface PeriodeArret {
  du: string;
  au: string;
  /** Absent : ligne d'avant la déclaration (saisie paie), considérée valide. */
  statut?: StatutArret | string | null;
}

/** Un arrêt refusé ne compte nulle part (paie, heures, planning). */
export function arretActif(a: { statut?: StatutArret | string | null }): boolean {
  return a.statut !== "refuse";
}

const JOUR_MS = 86_400_000;
const t = (iso: string) => Date.parse(`${iso.slice(0, 10)}T12:00:00Z`);

/** Jours calendaires entre deux dates incluses (0 si fin avant début). */
export function nbJours(du: string, au: string): number {
  if (!du || !au || au < du) return 0;
  return Math.round((t(au) - t(du)) / JOUR_MS) + 1;
}

/** Dates (YYYY-MM-DD) de [du, au] coupées à [debut, fin]. */
function joursEntre(du: string, au: string, debut: string, fin: string): string[] {
  const d = du < debut ? debut : du;
  const f = au > fin ? fin : au;
  const out: string[] = [];
  for (let j = d; j <= f; j = addDays(j, 1)) out.push(j);
  return out;
}

/**
 * Jours d'arrêt (union des arrêts non refusés, sans doublon) compris
 * entre `debut` et `fin` inclus, triés.
 */
export function joursArret(arrets: readonly PeriodeArret[], debut: string, fin: string): string[] {
  const set = new Set<string>();
  for (const a of arrets) {
    if (!arretActif(a) || !a.du || !a.au || a.au < a.du) continue;
    for (const j of joursEntre(a.du, a.au, debut, fin)) set.add(j);
  }
  return [...set].sort();
}

/** Bornes d'un mois "YYYY-MM" (fin incluse). */
export function bornesDuMois(mois: string): { debut: string; fin: string } {
  const [y, m] = mois.split("-").map(Number) as [number, number];
  return { debut: `${mois}-01`, fin: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
}

/** Jours d'arrêt d'un mois "YYYY-MM". */
export function joursArretDuMois(arrets: readonly PeriodeArret[], mois: string): string[] {
  const { debut, fin } = bornesDuMois(mois);
  return joursArret(arrets, debut, fin);
}

/** Le salarié est-il en arrêt ce jour-là ? */
export function estEnArret(arrets: readonly PeriodeArret[], jour: string): boolean {
  return arrets.some((a) => arretActif(a) && a.du <= jour && a.au >= jour);
}

/** Arrêt en cours (ou le prochain qui couvre ce jour). */
export function arretDuJour<T extends PeriodeArret>(arrets: readonly T[], jour: string): T | null {
  return arrets.find((a) => arretActif(a) && a.du <= jour && a.au >= jour) ?? null;
}

const estOuvre = (jour: string) => {
  const d = new Date(`${jour}T12:00:00Z`).getUTCDay();
  return d !== 0 && d !== 6;
};

/**
 * Heures prévues du mois, diminuées des jours d'arrêt : heures du contrat
 * × (jours ouvrés hors arrêt ÷ jours ouvrés du mois). Les jours ouvrés
 * sont du lundi au vendredi (le planning réel peut différer : ordre de
 * grandeur pour le suivi, le bulletin calcule l'absence en jours
 * calendaires — lib/paie/arrets.ts).
 */
export function heuresPrevuesDuMois(
  heuresContrat: number,
  mois: string,
  arrets: readonly PeriodeArret[],
): { heures: number; joursArret: number; joursOuvresArret: number; joursOuvresMois: number } {
  const { debut, fin } = bornesDuMois(mois);
  const ouvres = joursEntre(debut, fin, debut, fin).filter(estOuvre).length;
  const jours = joursArret(arrets, debut, fin);
  const ouvresArret = jours.filter(estOuvre).length;
  const heures = ouvres > 0 ? Math.round(heuresContrat * ((ouvres - ouvresArret) / ouvres) * 100) / 100 : heuresContrat;
  return { heures: Math.max(0, heures), joursArret: jours.length, joursOuvresArret: ouvresArret, joursOuvresMois: ouvres };
}

/**
 * Pointage attendu ce jour-là ? Non pendant un arrêt (ni « pointage
 * manquant », ni heures attendues).
 */
export function pointageAttendu(jour: string, arrets: readonly PeriodeArret[], joursPlanifies: ReadonlySet<string>): boolean {
  return joursPlanifies.has(jour) && !estEnArret(arrets, jour);
}

// ── Planning : affectations touchées par un arrêt ─────────────────────

export interface AffectationPlanning {
  id: string;
  start_at: string;
  status: string;
  tour_number?: string | null;
  driver_id?: string | null;
}

/** Statuts d'une affectation encore à faire (à remplacer si le chauffeur est arrêté). */
const A_FAIRE = new Set(["planned", "in_progress"]);

/**
 * Affectations du salarié qui tombent dans l'arrêt (jour de Paris du
 * départ prévu), encore à faire, triées par heure.
 */
export function affectationsTouchees<T extends AffectationPlanning>(entries: readonly T[], arret: { du: string; au: string }): T[] {
  return entries
    .filter((e) => A_FAIRE.has(e.status))
    .filter((e) => {
      const j = parisCalendarDate(e.start_at);
      return j >= arret.du && j <= arret.au;
    })
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
}

/**
 * Affectations que « Libérer » retire au chauffeur : touchées, encore
 * seulement prévues (une tournée démarrée ne se modifie pas d'ici) et à
 * venir. La tournée reste au planning, sans chauffeur : « à remplacer ».
 */
export function affectationsALiberer<T extends AffectationPlanning>(entries: readonly T[], arret: { du: string; au: string }, maintenant: Date = new Date()): T[] {
  return affectationsTouchees(entries, arret).filter((e) => e.status === "planned" && Date.parse(e.start_at) > maintenant.getTime());
}

// ── Vérifications d'une déclaration ───────────────────────────────────

export interface ArretExistant {
  id: string;
  type: string;
  du: string;
  au: string;
  /** work_stoppages.extension_of : début de l'arrêt initial. */
  extensionOf?: string | null;
  statut?: StatutArret | string | null;
}

export type Verification = { ok: true; extensionOf: string | null } | { ok: false; erreur: string };

/** Écart maximal (jours) entre la fin d'un arrêt et le début de sa prolongation (week-end). */
export const ECART_PROLONGATION_JOURS = 3;

/**
 * Contrôle d'une déclaration : dates cohérentes, pas de chevauchement avec
 * un arrêt non refusé, prolongation dans la continuité de l'arrêt
 * prolongé (même type). Renvoie la date de début de l'arrêt initial
 * (extension_of) pour une prolongation : les carences ne sont pas
 * réappliquées par la paie.
 */
export function verifierDeclaration(
  d: { type: string; du: string; au: string; prolongeId?: string | null },
  existants: readonly ArretExistant[],
  aujourdhui: string,
): Verification {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.du) || !/^\d{4}-\d{2}-\d{2}$/.test(d.au)) return { ok: false, erreur: "Dates invalides." };
  if (d.au < d.du) return { ok: false, erreur: "La date de fin doit être après la date de début." };
  if (nbJours(d.du, d.au) > 366) return { ok: false, erreur: "Un avis d'arrêt couvre au plus un an : déclarez une prolongation." };
  if (d.du > addDays(aujourdhui, 31)) return { ok: false, erreur: "La date de début est trop loin dans le futur." };
  if (d.du < addDays(aujourdhui, -366)) return { ok: false, erreur: "La date de début a plus d'un an : voyez avec la paie." };

  const actifs = existants.filter((a) => arretActif(a) && a.id !== d.prolongeId);
  const chevauche = actifs.find((a) => a.du <= d.au && a.au >= d.du);
  if (chevauche) return { ok: false, erreur: `Un arrêt est déjà enregistré du ${dateCourte(chevauche.du)} au ${dateCourte(chevauche.au)}.` };

  if (!d.prolongeId) return { ok: true, extensionOf: null };
  const prolonge = existants.find((a) => a.id === d.prolongeId);
  if (!prolonge || !arretActif(prolonge)) return { ok: false, erreur: "Arrêt prolongé introuvable." };
  if (prolonge.type !== d.type) return { ok: false, erreur: "Une prolongation garde le type de l'arrêt initial." };
  if (d.du <= prolonge.au) {
    return { ok: false, erreur: `La prolongation commence après la fin de l'arrêt prolongé (${dateCourte(prolonge.au)}).` };
  }
  if (d.du > addDays(prolonge.au, 1 + ECART_PROLONGATION_JOURS)) {
    return { ok: false, erreur: "La prolongation doit suivre l'arrêt prolongé : sinon, déclarez un nouvel arrêt initial." };
  }
  return { ok: true, extensionOf: prolonge.extensionOf && prolonge.extensionOf < prolonge.du ? prolonge.extensionOf : prolonge.du };
}

/** Arrêts qu'une nouvelle déclaration peut prolonger : non refusés, terminés récemment ou en cours. */
export function arretsProlongeables<T extends ArretExistant>(existants: readonly T[], aujourdhui: string): T[] {
  const limite = addDays(aujourdhui, -31);
  return existants.filter((a) => arretActif(a) && a.type !== "sans_solde" && a.au >= limite).sort((a, b) => b.du.localeCompare(a.du));
}

// ── Messages ──────────────────────────────────────────────────────────

/** "2026-10-12" → "12/10/2026". */
export function dateCourte(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/**
 * Alerte à l'encadrement du service. Jamais le type d'arrêt (maladie,
 * maternité…) : seulement l'absence et son effet sur le planning ; un
 * accident du travail rappelle la déclaration employeur.
 */
export function messageAlerteEncadrement(p: { nom: string; du: string; au: string; tournees: number; prolongation: boolean; accidentTravail: boolean; parEncadrement?: boolean }): string {
  const quoi = p.prolongation ? "prolongation d'arrêt" : "en arrêt";
  const tournees = p.tournees === 0 ? "aucune tournée planifiée à remplacer" : `${p.tournees} tournée${p.tournees > 1 ? "s" : ""} à remplacer`;
  const verif = p.parEncadrement ? "" : " Avis à vérifier dans Équipe › Congés › Arrêts.";
  const at = p.accidentTravail ? " Accident du travail : déclaration employeur (DAT) à faire sous 48 h." : "";
  return `${p.nom} ${quoi} du ${dateCourte(p.du)} au ${dateCourte(p.au)} : ${tournees}.${verif}${at}`;
}

export function messageDecisionSalarie(p: { du: string; au: string; statut: "valide" | "refuse"; motif?: string | null }): string {
  const periode = `du ${dateCourte(p.du)} au ${dateCourte(p.au)}`;
  if (p.statut === "valide") return `Votre arrêt de travail ${periode} a été enregistré. Il sera pris en compte sur votre bulletin.`;
  return `Votre déclaration d'arrêt ${periode} n'a pas été retenue${p.motif ? ` : ${p.motif}` : ""}. Contactez votre responsable.`;
}

/** L'avis a-t-il été envoyé après le délai légal de 48 h (à compter du début de l'arrêt) ? */
export function envoiTardif(du: string, envoyeLe: Date): boolean {
  const debut = Date.parse(`${du}T00:00:00Z`);
  return envoyeLe.getTime() - debut > (DELAI_ENVOI_HEURES + 24) * 3_600_000;
}

/**
 * Créneau horaire choisi au moment d'ajouter une adresse (saisie, scan,
 * étiquette, GO Navigation, bordereau de tournée), avant le bouton d'ajout.
 *
 * - Créneau ponctuel du jour = window_start / window_end de l'arrêt
 *   (« avant 10 h » : fin seule). Prioritaire sur les horaires de
 *   l'annuaire (lib/colis/horaires.ts, fenetresArret).
 * - Même format et mêmes règles pour POST /api/colis/arrets et
 *   PATCH /api/colis/arrets/[id] : `schemaCreneau` ci-dessous.
 * - Le choix n'est jamais reconduit d'une adresse à l'autre : retour à
 *   « Aucun » après chaque ajout (CRENEAU_AUCUN).
 *
 * Pur (sans accès réseau ni base) : testé dans lib/colis/__tests__/creneau.test.ts.
 */
import { z } from "zod";
import { creneauxDuJour, ecrireHeure, jourIso, lireHeure, normaliserSemaine, type Semaine } from "@/lib/colis/horaires";

/** Créneau ponctuel envoyé à l'API : heures « HH:MM », début facultatif. */
export interface CreneauSaisi {
  debut: string | null;
  fin: string | null;
}

// ── Validation (API et écran) ───────────────────────────────────

/** Message d'erreur d'un créneau, null s'il est valable. */
export function erreurCreneau(c: CreneauSaisi): string | null {
  const debut = c.debut?.trim() ? lireHeure(c.debut) : null;
  const fin = c.fin?.trim() ? lireHeure(c.fin) : null;
  if (c.debut?.trim() && debut === null) return "Heure de début invalide (format HH:MM, ex. 08:30).";
  if (c.fin?.trim() && fin === null) return "Heure de fin invalide (format HH:MM, ex. 13:00).";
  if (debut === null && fin === null) return "Créneau vide : choisissez « Aucun » ou indiquez une heure de fin.";
  if (debut !== null && fin !== null && fin <= debut) return "Créneau incohérent : l'heure de fin doit être après l'heure de début.";
  return null;
}

/** Créneau valable → colonnes de l'arrêt (« 08:00 », null si absent). */
export function colonnesCreneau(c: CreneauSaisi | null): { window_start: string | null; window_end: string | null } {
  const heure = (v: string | null) => {
    const m = v?.trim() ? lireHeure(v) : null;
    return m === null ? null : ecrireHeure(m);
  };
  return { window_start: heure(c?.debut ?? null), window_end: heure(c?.fin ?? null) };
}

/**
 * Schéma partagé par l'ajout (POST) et la modification (PATCH) d'un arrêt.
 * À compléter par `.nullable().optional()` côté route (null : sans créneau).
 */
export const schemaCreneau = z
  .object({ debut: z.string().max(8).nullable(), fin: z.string().max(8).nullable() })
  .superRefine((c, ctx) => {
    const erreur = erreurCreneau(c);
    if (erreur) ctx.addIssue({ code: z.ZodIssueCode.custom, message: erreur });
  });

// ── Boutons rapides ─────────────────────────────────────────────

export type CleCreneau = "aucun" | "avant10" | "avant12" | "08-10" | "10-13" | "12-15" | "13-16" | "15-18" | "ouverture" | "perso";

/**
 * Préréglages : « Avant 10 h » / « Avant 12 h » (fin seule) puis les
 * créneaux Predict DPD vus sur les bordereaux (10:00-13:00, 12:00-15:00…).
 */
export const PRESETS_CRENEAU: { cle: Exclude<CleCreneau, "aucun" | "ouverture" | "perso">; libelle: string; debut: string | null; fin: string }[] = [
  { cle: "avant10", libelle: "Avant 10 h", debut: null, fin: "10:00" },
  { cle: "avant12", libelle: "Avant 12 h", debut: null, fin: "12:00" },
  { cle: "08-10", libelle: "08–10", debut: "08:00", fin: "10:00" },
  { cle: "10-13", libelle: "10–13", debut: "10:00", fin: "13:00" },
  { cle: "12-15", libelle: "12–15", debut: "12:00", fin: "15:00" },
  { cle: "13-16", libelle: "13–16", debut: "13:00", fin: "16:00" },
  { cle: "15-18", libelle: "15–18", debut: "15:00", fin: "18:00" },
];

/** Choix à l'écran : bouton sélectionné, et heures du créneau personnalisé. */
export interface ChoixCreneau {
  cle: CleCreneau;
  /** Champs « HH:MM » (vides si non renseignés) ; utilisés pour « Personnalisé ». */
  debut: string;
  fin: string;
}

/** Choix par défaut, et après chaque ajout : aucun créneau. */
export const CRENEAU_AUCUN: ChoixCreneau = Object.freeze({ cle: "aucun", debut: "", fin: "" }) as ChoixCreneau;

/** Remise à « Aucun » après un ajout : le choix n'est pas reconduit sur l'adresse suivante. */
export function creneauApresAjout(): ChoixCreneau {
  return { ...CRENEAU_AUCUN };
}

/** Bouton rapide → choix (début / fin du préréglage). */
export function choisirCreneau(cle: CleCreneau, precedent: ChoixCreneau = CRENEAU_AUCUN): ChoixCreneau {
  if (cle === "aucun" || cle === "ouverture") return { cle, debut: "", fin: "" };
  // Personnalisé : part du créneau affiché pour n'avoir qu'à l'ajuster.
  if (cle === "perso") return { cle, debut: precedent.debut, fin: precedent.fin };
  const p = PRESETS_CRENEAU.find((x) => x.cle === cle)!;
  return { cle, debut: p.debut ?? "", fin: p.fin };
}

/**
 * Créneau lu (étiquette, bordereau, arrêt existant) → choix pré-sélectionné :
 * le bouton rapide correspondant, sinon « Personnalisé », « Aucun » si rien
 * de lisible ou d'incohérent.
 */
export function choixDepuisCreneau(debut: string | null | undefined, fin: string | null | undefined): ChoixCreneau {
  const c = { debut: debut ?? null, fin: fin ?? null };
  if ((!c.debut?.trim() && !c.fin?.trim()) || erreurCreneau(c)) return creneauApresAjout();
  const { window_start, window_end } = colonnesCreneau(c);
  const preset = PRESETS_CRENEAU.find((p) => p.debut === window_start && p.fin === window_end);
  if (preset) return choisirCreneau(preset.cle);
  return { cle: "perso", debut: window_start ?? "", fin: window_end ?? "" };
}

export type ResultatChoix = { ok: true; creneau: CreneauSaisi | null } | { ok: false; erreur: string };

/**
 * Choix → créneau à envoyer. « Aucun » et « Horaires d'ouverture » : pas de
 * créneau ponctuel (l'annuaire s'applique s'il connaît l'adresse).
 * « Personnalisé » : heure de fin obligatoire, début facultatif.
 */
export function validerChoix(choix: ChoixCreneau): ResultatChoix {
  if (choix.cle === "aucun" || choix.cle === "ouverture") return { ok: true, creneau: null };
  if (choix.cle === "perso" && !choix.fin.trim()) return { ok: false, erreur: "Indiquez l'heure de fin du créneau (le début est facultatif)." };
  const c = { debut: choix.debut.trim() || null, fin: choix.fin.trim() || null };
  const erreur = erreurCreneau(c);
  if (erreur) return { ok: false, erreur };
  const { window_start, window_end } = colonnesCreneau(c);
  return { ok: true, creneau: { debut: window_start, fin: window_end } };
}

/** « 8h15 », « 10h » (affichage court). */
export function heureCourte(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

/** Libellé d'un choix : « Avant 10h », « 10h–13h », « À partir de 14h », null pour « Aucun ». */
export function libelleChoix(choix: ChoixCreneau): string | null {
  if (choix.cle === "ouverture") return "Horaires d'ouverture";
  const r = validerChoix(choix);
  if (!r.ok || !r.creneau) return null;
  const d = lireHeure(r.creneau.debut);
  const f = lireHeure(r.creneau.fin);
  if (d === null) return `Avant ${heureCourte(f!)}`;
  if (f === null) return `À partir de ${heureCourte(d)}`;
  return `${heureCourte(d)}–${heureCourte(f)}`;
}

// ── Horaires d'ouverture connus → suggestion ────────────────────

export interface SuggestionOuverture {
  /** « Ouvert aujourd'hui 8h15–12h15 / 13h30–17h15 » ou « Fermé aujourd'hui ». */
  libelle: string;
  ferme: boolean;
  /** Plages du jour en minutes. */
  plages: [number, number][];
}

/**
 * Semaine type de l'annuaire (adresse pro) → ce qu'elle dit du jour de la
 * tournée ; null si ce jour n'y est pas renseigné.
 */
export function suggestionOuverture(semaine: Semaine | null | undefined, ymd: string, quand = "aujourd'hui"): SuggestionOuverture | null {
  if (!semaine) return null;
  const creneaux = creneauxDuJour(normaliserSemaine(semaine), jourIso(ymd));
  if (!creneaux) return null;
  if (!creneaux.length) return { libelle: `Fermé ${quand}`, ferme: true, plages: [] };
  const plages = creneaux.map((c): [number, number] => [lireHeure(c.open)!, lireHeure(c.close)!]);
  return { libelle: `Ouvert ${quand} ${plages.map(([d, f]) => `${heureCourte(d)}–${heureCourte(f)}`).join(" / ")}`, ferme: false, plages };
}

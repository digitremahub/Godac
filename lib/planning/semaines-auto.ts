/**
 * Planning de la semaine suivante généré le jeudi, à confirmer avant le
 * vendredi 17 h (heure de Paris), puis envoyé aux chauffeurs. Logique pure :
 * aucun accès réseau ni base. Testée dans lib/planning/__tests__/semaines-auto.test.ts ;
 * l'écriture est faite par lib/planning/semaines-auto-serveur.ts, les crons
 * app/api/cron/planning-semaine-suivante et app/api/cron/planning-envoi-auto.
 *
 * Flux (suivi dans planning_semaines_auto, migration 20261111000001) :
 *  - jeudi, ~5-6 h : la semaine suivante est générée (copie de la semaine en
 *    cours, tournées fermées exclues, absents laissés « à remplacer »), NON
 *    publiée : invisible des chauffeurs, sans notification pour eux ;
 *  - l'encadrement confirme (publication immédiate) ou modifie ;
 *  - vendredi 17 h : envoi automatique si rien n'a changé, rappel sinon.
 *
 * Plan Vercel Hobby : un cron s'exécute au plus une fois par jour et seulement
 * « dans l'heure » prévue. Le vendredi est donc planifié deux fois (15 h et
 * 16 h UTC) et le contrôle de l'heure de Paris est refait ici.
 */
import { addDays, parisCalendarDate, parisWallTimeToUtcISOString } from "@/lib/planning/dates";
import { estAbsentOuInactif, type ContexteAbsences, type RaisonAbsence } from "@/lib/planning/semaines-auto-absences";
import { cleSemaine, lundiDe } from "@/lib/planning/publication";
import { estCopiable, heureDe, jourDe, planifierCopies, rangJour, type AffectationPlanning, type CopieDemandee } from "@/lib/planning/semaine";

// ---------------------------------------------------------------------------
// Constantes à régler ici.
// ---------------------------------------------------------------------------

/**
 * Une semaine générée puis MODIFIÉE à la main mais pas confirmée n'est pas
 * envoyée toute seule le vendredi (on n'envoie pas un planning à moitié
 * édité) : l'encadrement reçoit un rappel. Passer à true pour l'envoyer quand même.
 */
export const PUBLICATION_AUTO_SI_MODIFIE = false;

/** Heure de Paris à partir de laquelle le vendredi publie tout seul. */
export const HEURE_ENVOI_AUTO = 17;

/** Rang du jour (0 = lundi) : génération le jeudi, envoi le vendredi. */
export const RANG_JEUDI = 3;
export const RANG_VENDREDI = 4;

/** Un service publié depuis moins de ce délai n'est pas annoncé de nouveau par le résumé du vendredi. */
export const DELAI_SANS_RESUME_HEURES = 20;

export const LIMITE_CONFIRMATION = "vendredi 17 h";

/** Génération à la demande : on peut préparer jusqu'à ce nombre de semaines à venir (la semaine suivante comprise). */
export const SEMAINES_A_L_AVANCE = 8;

/** Génération à la demande : la semaine recopiée est la plus proche avant la cible, au plus ce nombre de semaines en arrière. */
export const SEMAINES_SOURCE_MAX = 4;

export const MESSAGE_SANS_SOURCE = "Aucune semaine à recopier : créez d'abord vos tournées ou dupliquez une semaine.";

// ---------------------------------------------------------------------------
// Calendrier (Europe/Paris).
// ---------------------------------------------------------------------------

export interface InstantParis {
  /** Jour de Paris (AAAA-MM-JJ). */
  jour: string;
  heure: number;
  minute: number;
  /** 0 = lundi … 6 = dimanche. */
  rang: number;
}

/** Jour, heure et jour de la semaine à Paris : le changement d'heure est géré par Intl. */
export function instantParis(maintenant: Date): InstantParis {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(maintenant)
      .map((x) => [x.type, x.value]),
  );
  const jour = parisCalendarDate(maintenant.toISOString());
  return { jour, heure: Number(p.hour), minute: Number(p.minute), rang: rangJour(jour) };
}

export interface SemaineSuivante {
  /** Lundi de la semaine en cours : la source des copies. */
  lundiSource: string;
  /** Lundi → dimanche de la semaine générée. */
  lundi: string;
  dimanche: string;
}

/** Semaine qui suit celle du jour donné (n'importe quel jour de la semaine en cours). */
export function semaineSuivante(jourParis: string): SemaineSuivante {
  const lundiSource = lundiDe(jourParis);
  return { lundiSource, lundi: addDays(lundiSource, 7), dimanche: addDays(lundiSource, 13) };
}

/**
 * Lundis des semaines qu'on peut préparer à la demande : de la semaine suivante
 * (N+1) jusqu'à SEMAINES_A_L_AVANCE semaines plus loin. La semaine en cours et
 * le passé n'en font pas partie : seule une semaine qui commence après aujourd'hui.
 */
export function semainesPreparables(jourParis: string): string[] {
  const premier = semaineSuivante(jourParis).lundi;
  return Array.from({ length: SEMAINES_A_L_AVANCE }, (_, i) => addDays(premier, 7 * i));
}

/** Ce lundi est-il dans la fenêtre des semaines préparables ? */
export const estSemainePreparable = (lundi: string, jourParis: string) => semainesPreparables(jourParis).includes(lundi);

/** Seule la semaine suivante (N+1) part toute seule le vendredi 17 h ; les plus lointaines attendent la confirmation. */
export const envoiAutomatiquePrevu = (lundi: string, jourParis: string) => lundi === semaineSuivante(jourParis).lundi;

/** Lundis (jour de Paris) des semaines qui comptent au moins une affectation recopiable (chauffeur et véhicule, tournée ouverte). */
export function lundisAvecAffectations(lignes: readonly AffectationPlanning[]): Set<string> {
  return new Set(lignes.filter((l) => l.tour_open !== false && estCopiable(l)).map((l) => lundiDe(jourDe(l.start_at))));
}

/**
 * Semaine à recopier pour une semaine cible quelconque : la plus proche AVANT
 * la cible qui a des affectations, au plus SEMAINES_SOURCE_MAX semaines en arrière.
 * Null s'il n'y en a aucune (message MESSAGE_SANS_SOURCE).
 */
export function choisirSemaineSource(lundiCible: string, lundisAvecAffectation: ReadonlySet<string>): string | null {
  for (let i = 1; i <= SEMAINES_SOURCE_MAX; i++) {
    const lundi = addDays(lundiCible, -7 * i);
    if (lundisAvecAffectation.has(lundi)) return lundi;
  }
  return null;
}

/** « vendredi 6 novembre à 17:12 » (heure de Paris). */
export function libelleDateHeureParis(iso: string): string {
  const date = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));
  const heure = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  return `${date} à ${heure}`;
}

/** Le cron du jeudi n'agit que le jeudi (Paris) ; sinon la raison est renvoyée. */
export function generationDuJour(maintenant: Date): { ok: true; semaine: SemaineSuivante } | { ok: false; raison: string } {
  const t = instantParis(maintenant);
  if (t.rang !== RANG_JEUDI) return { ok: false, raison: `Pas jeudi à Paris (${t.jour}) : rien à générer.` };
  return { ok: true, semaine: semaineSuivante(t.jour) };
}

/** Numéro de semaine ISO (1 à 53) de la semaine commençant ce lundi. */
export function numeroSemaineIso(lundi: string): number {
  const jeudi = addDays(lundi, 3);
  const annee = Number(jeudi.slice(0, 4));
  const jours = Math.round((Date.parse(`${jeudi}T00:00:00Z`) - Date.parse(`${annee}-01-01T00:00:00Z`)) / 86_400_000);
  return Math.floor(jours / 7) + 1;
}

/** 52 ou 53 semaines ISO dans l'année. */
export function nombreSemainesIso(annee: number): number {
  return numeroSemaineIso(lundiDe(`${annee}-12-28`));
}

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"] as const;
const numeroJour = (n: string) => (n === "1" ? "1er" : n);

/** « du lundi 9 au dimanche 15 novembre », « du lundi 29 décembre 2026 au dimanche 3 janvier 2027 ». */
export function libelleSemaine(lundi: string): string {
  const dimanche = addDays(lundi, 6);
  const [a1, m1, j1] = lundi.split("-") as [string, string, string];
  const [a2, m2, j2] = dimanche.split("-") as [string, string, string];
  const mois1 = MOIS[Number(m1) - 1]!;
  const mois2 = MOIS[Number(m2) - 1]!;
  if (a1 !== a2) return `du lundi ${numeroJour(String(Number(j1)))} ${mois1} ${a1} au dimanche ${numeroJour(String(Number(j2)))} ${mois2} ${a2}`;
  if (m1 !== m2) return `du lundi ${numeroJour(String(Number(j1)))} ${mois1} au dimanche ${numeroJour(String(Number(j2)))} ${mois2}`;
  return `du lundi ${numeroJour(String(Number(j1)))} au dimanche ${numeroJour(String(Number(j2)))} ${mois2}`;
}

/** « lundi 9 novembre », « lundi 1er décembre ». */
export function libelleLundi(lundi: string): string {
  const [, m, j] = lundi.split("-") as [string, string, string];
  return `lundi ${numeroJour(String(Number(j)))} ${MOIS[Number(m) - 1]!}`;
}

/** Vendredi précédant la semaine : à partir de ce jour, le planning à confirmer est urgent. */
export const vendrediAvant = (lundi: string) => addDays(lundi, -3);

export const estUrgentLeVendredi = (lundi: string, jourParis: string) => jourParis >= vendrediAvant(lundi);

// ---------------------------------------------------------------------------
// Suivi (planning_semaines_auto) : état et décisions.
// ---------------------------------------------------------------------------

export interface LigneSuivi {
  id: string;
  organization_id: string;
  service_id: string;
  semaine_debut: string;
  genere_at: string;
  modifie_at: string | null;
  confirme_at: string | null;
  confirme_par: string | null;
  publie_at: string | null;
  publie_mode: "auto" | "manuel" | null;
  rappel_envoye_at: string | null;
  resume: unknown;
}

export const CHAMPS_SUIVI = "id, organization_id, service_id, semaine_debut, genere_at, modifie_at, confirme_at, confirme_par, publie_at, publie_mode, rappel_envoye_at, resume";

export type EtatSemaine = "a_confirmer" | "modifiee" | "publiee";

/** À confirmer (intacte), modifiée mais pas confirmée, ou publiée (confirmée ou envoyée). */
export function etatSemaine(l: Pick<LigneSuivi, "modifie_at" | "confirme_at" | "publie_at">): EtatSemaine {
  if (l.publie_at || l.confirme_at) return "publiee";
  return l.modifie_at ? "modifiee" : "a_confirmer";
}

/** Semaines générées et pas encore publiées : leurs lignes ne sont pas visibles des chauffeurs. */
export function semainesMasquees(lignes: readonly Pick<LigneSuivi, "service_id" | "semaine_debut" | "publie_at">[]): Set<string> {
  return new Set(lignes.filter((l) => !l.publie_at).map((l) => cleSemaine(l.service_id, l.semaine_debut)));
}

/** Une affectation appartient-elle à une semaine masquée (service + semaine de Paris) ? */
export function estMasquee(masquees: ReadonlySet<string>, ligne: { service_id: string; start_at: string }): boolean {
  return masquees.has(cleSemaine(ligne.service_id, lundiDe(jourDe(ligne.start_at))));
}

/**
 * Services déjà publiés depuis peu : le résumé du vendredi (weekly-planning-digest)
 * ne les annonce pas une seconde fois, les chauffeurs ont reçu leur récapitulatif.
 */
export function servicesPublieesRecemment(validations: readonly { service_id: string; validated_at: string }[], maintenant: Date, delaiHeures = DELAI_SANS_RESUME_HEURES): Set<string> {
  const limite = maintenant.getTime() - delaiHeures * 3_600_000;
  return new Set(validations.filter((v) => Date.parse(v.validated_at) > limite).map((v) => v.service_id));
}

export type DecisionEnvoiAuto =
  | { action: "publier" }
  /** `motif: "doublon_fusion"` : une tournée d'origine d'une fusion est encore affectée (le rappel le dit, qu'elle soit modifiée ou non). */
  | { action: "rappeler"; motif?: "doublon_fusion" }
  | { action: "rien"; raison: "pas_vendredi" | "avant_17h" | "deja_publiee" | "rappel_deja_envoye" | "mauvaise_semaine" };

/**
 * Que faire d'une semaine suivie à l'exécution du cron du vendredi ?
 *  - pas vendredi, ou avant 17:00 à Paris : rien (le cron est planifié à 15 h
 *    et 16 h UTC, une seule des deux tombe après 17 h selon la saison) ;
 *  - déjà confirmée ou publiée : rien (idempotent) ;
 *  - intacte : publication automatique ;
 *  - modifiée : rappel (une seule fois), sauf PUBLICATION_AUTO_SI_MODIFIE ;
 *  - DOUBLON de fusion (`doublonsFusion` > 0 : une tournée d'origine d'une
 *    fusion est encore affectée, lib/planning/fusion-verrou.ts) : jamais
 *    d'envoi automatique, même sans modification ni PUBLICATION_AUTO_SI_MODIFIE ;
 *    rappel à l'encadrement (une seule fois), tant que le doublon subsiste.
 */
export function decisionEnvoiAuto(p: {
  ligne: Pick<LigneSuivi, "semaine_debut" | "modifie_at" | "confirme_at" | "publie_at" | "rappel_envoye_at">;
  maintenant: Date;
  publierSiModifie?: boolean;
  /** Tournées d'origine d'une fusion encore affectées dans cette semaine (ce service). */
  doublonsFusion?: number;
}): DecisionEnvoiAuto {
  const t = instantParis(p.maintenant);
  if (t.rang !== RANG_VENDREDI) return { action: "rien", raison: "pas_vendredi" };
  if (t.heure < HEURE_ENVOI_AUTO) return { action: "rien", raison: "avant_17h" };
  if (p.ligne.semaine_debut !== semaineSuivante(t.jour).lundi) return { action: "rien", raison: "mauvaise_semaine" };
  if (p.ligne.publie_at || p.ligne.confirme_at) return { action: "rien", raison: "deja_publiee" };
  const doublon = (p.doublonsFusion ?? 0) > 0;
  if (!doublon && (!p.ligne.modifie_at || (p.publierSiModifie ?? PUBLICATION_AUTO_SI_MODIFIE))) return { action: "publier" };
  if (p.ligne.rappel_envoye_at) return { action: "rien", raison: "rappel_deja_envoye" };
  return doublon ? { action: "rappeler", motif: "doublon_fusion" } : { action: "rappeler" };
}

/** Peut-on confirmer ? Non s'il reste des cases à remplacer, sauf « Envoyer quand même ». */
export function verdictConfirmation(p: { casesARemplacer: number; envoyerQuandMeme?: boolean }): { ok: true } | { ok: false; code: "cases_a_remplacer"; message: string } {
  if (p.casesARemplacer > 0 && !p.envoyerQuandMeme) {
    return {
      ok: false,
      code: "cases_a_remplacer",
      message: `${p.casesARemplacer} case${p.casesARemplacer > 1 ? "s" : ""} à remplacer ${p.casesARemplacer > 1 ? "restent" : "reste"} sans chauffeur. Affectez-les, ou envoyez quand même.`,
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Résumé de la génération.
// ---------------------------------------------------------------------------

export type { ContexteAbsences, RaisonAbsence };

/** Une case créée sans chauffeur parce que le chauffeur recopié est absent. Jamais de motif médical. */
export interface CaseAbsente {
  entree_id: string | null;
  /** Jour de Paris et heure de la tournée. */
  jour: string;
  heure: string;
  tournee: string;
  nom: string;
  raison: RaisonAbsence;
  /** Dates du congé (jamais celles d'un arrêt). */
  du: string | null;
  au: string | null;
}

export interface ResumeSemaine {
  /** Lignes créées (avec ou sans chauffeur). */
  tournees: number;
  chauffeurs: number;
  /** Cases sans chauffeur : absents + tournées des modèles. */
  a_remplacer: number;
  sans_chauffeur_modeles: number;
  fermees: number;
  conflits: number;
  /** Cases déjà présentes dans la semaine (planning commencé à la main) : laissées telles quelles. */
  deja_presentes: number;
  /** Cases de tournées d'origine d'une fusion : ni recopiées ni comblées par un modèle (lib/planning/fusion-verrou.ts). */
  fusionnees: number;
  absents: CaseAbsente[];
}

export const resumeVide = (): ResumeSemaine => ({ tournees: 0, chauffeurs: 0, a_remplacer: 0, sans_chauffeur_modeles: 0, fermees: 0, conflits: 0, deja_presentes: 0, fusionnees: 0, absents: [] });

const nombre = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Résumé lu en base (jsonb) : tolérant à une valeur absente ou incomplète. */
export function lireResume(brut: unknown): ResumeSemaine {
  const r = (brut && typeof brut === "object" ? brut : {}) as Record<string, unknown>;
  const absents = Array.isArray(r.absents) ? (r.absents as CaseAbsente[]).filter((a) => a && typeof a.nom === "string") : [];
  return {
    tournees: nombre(r.tournees),
    chauffeurs: nombre(r.chauffeurs),
    a_remplacer: nombre(r.a_remplacer),
    sans_chauffeur_modeles: nombre(r.sans_chauffeur_modeles),
    fermees: nombre(r.fermees),
    conflits: nombre(r.conflits),
    deja_presentes: nombre(r.deja_presentes),
    fusionnees: nombre(r.fusionnees),
    absents,
  };
}

const jj = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

/** « Dupont en congé du 12/11 au 14/11 », « Martin absent » : jamais le motif d'un arrêt. */
export function libelleAbsent(c: Pick<CaseAbsente, "nom" | "raison" | "du" | "au">): string {
  if (c.raison === "conge" && c.du && c.au) return `${c.nom} en congé du ${jj(c.du)} au ${jj(c.au)}`;
  if (c.raison === "conge_demande" && c.du && c.au) return `${c.nom} : congé demandé du ${jj(c.du)} au ${jj(c.au)}`;
  if (c.raison === "conge") return `${c.nom} en congé`;
  if (c.raison === "conge_demande") return `${c.nom} : congé demandé`;
  return `${c.nom} absent`;
}

/** Les absents, une fois chacun : « Dupont en congé du 12/11 au 14/11 ; Martin absent ». */
export function listeAbsents(absents: readonly CaseAbsente[]): string {
  const vus = new Set<string>();
  const out: string[] = [];
  for (const a of absents) {
    const l = libelleAbsent(a);
    if (!vus.has(l)) {
      vus.add(l);
      out.push(l);
    }
  }
  return out.join(" ; ");
}

/** « 24 tournées planifiées, 18 chauffeurs affectés, 3 cases à remplacer, 1 tournée fermée, 0 conflit » (+ « 1 tournée fusionnée » s'il y en a) */
export function texteResume(r: ResumeSemaine): string {
  return [
    `${pluriel(r.tournees, "tournée planifiée", "tournées planifiées")}`,
    `${pluriel(r.chauffeurs, "chauffeur affecté", "chauffeurs affectés")}`,
    `${pluriel(r.a_remplacer, "case à remplacer", "cases à remplacer")}`,
    `${pluriel(r.fermees, "tournée fermée", "tournées fermées")}`,
    ...(r.fusionnees ? [pluriel(r.fusionnees, "tournée fusionnée", "tournées fusionnées")] : []),
    `${pluriel(r.conflits, "conflit", "conflits")}`,
  ].join(", ");
}

const duService = (service?: string | null) => (service ? ` — ${service}` : "");

export const titreGeneration = (lundi: string, service?: string | null) => `Planning ${libelleSemaine(lundi)} généré : à confirmer avant ${LIMITE_CONFIRMATION}${duService(service)}`;

/** Message de l'alerte d'encadrement envoyée à la génération. */
export function messageGeneration(lundi: string, resume: ResumeSemaine, service?: string | null): string {
  const lignes = [titreGeneration(lundi, service), `${texteResume(resume)}.`];
  if (resume.absents.length) lignes.push(`À remplacer : ${listeAbsents(resume.absents)}.`);
  if (resume.fusionnees) lignes.push(`${pluriel(resume.fusionnees, "tournée fusionnée laissée vide", "tournées fusionnées laissées vides")} (non recopiée${resume.fusionnees > 1 ? "s" : ""} : elle${resume.fusionnees > 1 ? "s sont regroupées" : " est regroupée"} dans une autre tournée).`);
  if (resume.deja_presentes) lignes.push(`${pluriel(resume.deja_presentes, "case déjà présente laissée telle quelle", "cases déjà présentes laissées telles quelles")} (planning commencé à la main).`);
  return lignes.join("\n");
}

/**
 * Absence apparue APRÈS la génération (congé approuvé entre le jeudi et le vendredi) :
 * signalement à l'encadrement qui voit la semaine à confirmer. Jamais de motif.
 */
export const messageAbsenceApparue = (p: { nom: string; du: string; au: string; lundi: string; nombre: number; service?: string | null }) =>
  `${p.nom} en congé du ${jj(p.du)} au ${jj(p.au)}, approuvé après la génération du planning ${libelleSemaine(p.lundi)}${duService(p.service)}\n${pluriel(p.nombre, "tournée est", "tournées sont")} à remplacer avant l'envoi aux chauffeurs.`;

/** Rappel critique du vendredi : semaine modifiée mais pas envoyée. */
export const messageRappelModifie = (lundi: string, service?: string | null) =>
  `Planning modifié mais pas envoyé : confirmez maintenant${duService(service)}\nLe planning ${libelleSemaine(lundi)} a été modifié depuis sa génération automatique : il n'est pas envoyé tout seul aux chauffeurs.`;

/** Rappel critique du vendredi : une tournée d'origine d'une fusion est encore affectée (doublon). */
export const messageRappelDoublonFusion = (lundi: string, doublons: number, service?: string | null) =>
  `Planning non envoyé : ${pluriel(doublons, "doublon de tournée fusionnée", "doublons de tournées fusionnées")}${duService(service)}\nLe planning ${libelleSemaine(lundi)} n'est pas envoyé tout seul : ${pluriel(doublons, "tournée d'origine d'une fusion est encore affectée", "tournées d'origine d'une fusion sont encore affectées")}. Retirez l'affectation ou gardez la tournée séparée, puis confirmez.`;

/** Clôture : envoi automatique. */
export const messageEnvoiAuto = (lundi: string, casesARemplacer: number, service?: string | null) =>
  `Planning envoyé automatiquement aux chauffeurs${duService(service)}\nSemaine ${libelleSemaine(lundi)}, sans changement depuis sa génération.${casesARemplacer > 0 ? ` ${pluriel(casesARemplacer, "case reste", "cases restent")} à remplacer.` : ""}`;

// Clés de dédoublonnage des alertes (index unique alerts_cle_dedoublonnage_unique).
export const cleAlerteGeneration = (serviceId: string, lundi: string) => `planning:a_confirmer:${serviceId}:${lundi}`;
export const cleAlerteRappel = (serviceId: string, lundi: string) => `planning:rappel:${serviceId}:${lundi}`;
export const cleAlerteEnvoi = (serviceId: string, lundi: string) => `planning:envoye:${serviceId}:${lundi}`;

/** Rôles qui reçoivent ces alertes (le manager : son service seulement, lib/alerts/destinataires.ts). Jamais le chauffeur ni le comptable. */
export const ROLES_DESTINATAIRES_PLANNING = ["manager", "exploitation", "direction"] as const;

// ---------------------------------------------------------------------------
// Génération : plan de la semaine d'un service.
// ---------------------------------------------------------------------------

export interface ModeleGeneration {
  service_id: string;
  tour_number: string;
  /** « 07:00:00 » ou « 07:00 ». */
  departure_time: string;
  /** 0 = dimanche … 6 = samedi. */
  weekdays: number[];
  default_vehicle_id: string | null;
}

export interface LigneAGenerer {
  service_id: string;
  tour_number: string;
  driver_id: string | null;
  vehicle_id: string | null;
  start_at: string;
  origine: "copie" | "modele";
}

export interface PlanSemaine {
  lignes: LigneAGenerer[];
  /** Cases créées sans chauffeur parce que le chauffeur recopié est absent (entree_id renseigné après l'insertion). */
  absents: CaseAbsente[];
  resume: ResumeSemaine;
}

const cleCase = (tournee: string, jour: string) => `${tournee}|${jour}`;

/**
 * Plan de la semaine cible d'UN service (la suivante le jeudi, n'importe quelle
 * semaine à venir à la demande), sans rien écraser :
 *  - source : affectations de la semaine `lundiSource` (la semaine précédente le
 *    jeudi, plus ancienne si besoin à la demande), recopiées jour pour jour
 *    (lib/planning/semaine.ts › planifierCopies : même heure de Paris, changement
 *    d'heure compris), SAUF tournées fermées (non recopiées) ;
 *  - une case (tournée × jour) déjà présente dans la semaine cible n'est pas
 *    touchée ; seules les cases vides sont remplies ;
 *  - chauffeur recopié absent (congé approuvé ou demandé, arrêt, compte inactif
 *    ou sorti) : la case est créée SANS chauffeur, « à remplacer » ;
 *  - modèles actifs : une ligne sans chauffeur pour chaque tournée × jour du
 *    modèle encore vide (jamais en double d'une copie, ni sur un jour fermé) ;
 *  - tournées d'origine d'une fusion (`fusionnees`) : ni recopiées (source), ni
 *    créées (cible, copie ou modèle) ; comptées dans le résumé.
 */
export function planifierSemaineSuivante(p: {
  lundiSource: string;
  lundiCible: string;
  sources: readonly AffectationPlanning[];
  existantes: readonly AffectationPlanning[];
  modeles: readonly ModeleGeneration[];
  contexte: ContexteAbsences;
  nomDe: (driverId: string) => string;
  /**
   * Cases (clés « tournée|jour », semaine source COMME cible) des tournées
   * d'origine d'une fusion : une tournée fusionnée n'est ni recopiée comme une
   * affectation ni comblée par un modèle, et la fusion elle-même n'est pas
   * recopiée (lib/planning/fusion-verrou.ts › clesTourneeJour).
   */
  fusionnees?: ReadonlySet<string>;
}): PlanSemaine {
  const joursSource = new Set(Array.from({ length: 7 }, (_, i) => addDays(p.lundiSource, i)));
  const joursCible = Array.from({ length: 7 }, (_, i) => addDays(p.lundiCible, i));
  const dansSource = p.sources.filter((s) => joursSource.has(jourDe(s.start_at)) && s.status !== "cancelled");
  const existantes = p.existantes.filter((e) => e.status !== "cancelled");
  // Tournées fermées de la semaine en cours : ni recopiées, ni comblées par un modèle.
  // Clés exprimées en jours de la semaine CIBLE (même jour de la semaine).
  const decalage = Math.round((Date.parse(`${p.lundiCible}T00:00:00Z`) - Date.parse(`${p.lundiSource}T00:00:00Z`)) / 86_400_000);
  const fermeesSource = new Set(dansSource.filter((s) => s.tour_open === false).map((s) => cleCase(s.tour_number, addDays(jourDe(s.start_at), decalage))));

  // Cases déjà présentes dans la semaine cible (une tournée par jour, quelle que soit l'heure).
  const occupees = new Set(existantes.map((e) => cleCase(e.tour_number, jourDe(e.start_at))));

  const fusionnees = p.fusionnees ?? new Set<string>();
  const fusionneesCible = new Set<string>();
  const copiables = dansSource.filter((s) => s.tour_open !== false && estCopiable(s));
  const demandes: CopieDemandee[] = [];
  let dejaPresentes = 0;
  for (const source of copiables) {
    const date = addDays(jourDe(source.start_at), decalage);
    // Tournée d'origine d'une fusion (semaine source ou cible) : pas une affectation à recopier.
    if (fusionnees.has(cleCase(source.tour_number, jourDe(source.start_at))) || fusionnees.has(cleCase(source.tour_number, date))) {
      fusionneesCible.add(cleCase(source.tour_number, date));
      continue;
    }
    if (occupees.has(cleCase(source.tour_number, date))) {
      dejaPresentes++;
      continue;
    }
    demandes.push({ source, date });
  }

  const absence = (driverId: string, date: string) => estAbsentOuInactif(driverId, date, p.contexte);
  const copies = planifierCopies(demandes, existantes, { absent: (id, date) => absence(id, date) !== null });
  const parSource = new Map(copiables.map((s) => [s.id, s]));
  const lignes: LigneAGenerer[] = copies.aCreer.map((c) => ({ service_id: c.service_id, tour_number: c.tour_number, driver_id: c.driver_id, vehicle_id: c.vehicle_id, start_at: c.start_at, origine: "copie" }));

  const absents: CaseAbsente[] = [];
  for (const c of copies.aRemplacer) {
    const source = parSource.get(c.sourceId);
    const jour = jourDe(c.start_at);
    const a = source?.driver_id ? absence(source.driver_id, jour) : null;
    absents.push({
      entree_id: null,
      jour,
      heure: heureDe(c.start_at),
      tournee: c.tour_number,
      nom: source?.driver_id ? p.nomDe(source.driver_id) : "Chauffeur",
      raison: a?.raison ?? "absent",
      du: a?.du ?? null,
      au: a?.au ?? null,
    });
  }

  // Modèles : cases encore vides, jamais en double d'une copie ni sur un jour fermé.
  const prises = new Set<string>([...occupees, ...fermeesSource, ...lignes.map((l) => cleCase(l.tour_number, jourDe(l.start_at)))]);
  for (const cle of fusionnees) if (joursCible.includes(cle.split("|")[1] ?? "")) prises.add(cle);
  for (const jour of joursCible) {
    const jourSemaine = new Date(`${jour}T12:00:00Z`).getUTCDay();
    for (const m of p.modeles) {
      if (!(m.weekdays ?? []).includes(jourSemaine) || !m.tour_number) continue;
      const cle = cleCase(m.tour_number, jour);
      if (fusionnees.has(cle)) fusionneesCible.add(cle);
      if (prises.has(cle)) continue;
      prises.add(cle);
      lignes.push({
        service_id: m.service_id,
        tour_number: m.tour_number,
        driver_id: null,
        vehicle_id: m.default_vehicle_id ?? null,
        start_at: parisWallTimeToUtcISOString(jour, String(m.departure_time).slice(0, 5)),
        origine: "modele",
      });
    }
  }

  const conflits = compterConflitsVehicule([...existantes, ...lignes.map((l, i) => ({ ...l, id: `plan-${i}`, status: "planned" }))]);
  const resume = resumeDesLignes(lignes, absents, { fermees: fermeesSource.size, conflits, deja_presentes: dejaPresentes, fusionnees: fusionneesCible.size });
  return { lignes, absents, resume };
}

/** Véhicule posé au même instant sur deux chauffeurs différents : un conflit par véhicule et par heure. */
export function compterConflitsVehicule(lignes: readonly Pick<AffectationPlanning, "vehicle_id" | "driver_id" | "start_at" | "status">[]): number {
  const groupes = new Map<string, Set<string>>();
  for (const l of lignes) {
    if (!l.vehicle_id || !l.driver_id || (l.status !== "planned" && l.status !== "in_progress")) continue;
    const k = `${l.vehicle_id}|${Date.parse(l.start_at)}`;
    groupes.set(k, (groupes.get(k) ?? new Set()).add(l.driver_id));
  }
  return [...groupes.values()].filter((chauffeurs) => chauffeurs.size > 1).length;
}

// ---------------------------------------------------------------------------
// Bandeau du Planning : état en direct de la semaine (lecture des lignes).
// ---------------------------------------------------------------------------

export interface LigneBandeau {
  id: string;
  service_id: string;
  tour_number: string;
  driver_id: string | null;
  start_at: string;
  status: string;
  tour_open?: boolean | null;
  nom_chauffeur?: string | null;
  /** Tournée d'origine d'une fusion ce jour-là (lib/planning/fusion-verrou.ts) : case verrouillée, jamais « à pourvoir ». */
  fusionnee?: boolean;
}

export interface CaseBandeau {
  entree_id: string;
  jour: string;
  heure: string;
  tournee: string;
}

/** Cases à pourvoir en ce moment : prévues, ouvertes, sans chauffeur, hors tournées fusionnées. */
export function casesSansChauffeur(lignes: readonly LigneBandeau[]): CaseBandeau[] {
  return lignes
    .filter((l) => l.status === "planned" && l.tour_open !== false && !l.fusionnee && !l.driver_id && !l.tour_number.startsWith("PRESENCE-"))
    .map((l) => ({ entree_id: l.id, jour: jourDe(l.start_at), heure: heureDe(l.start_at), tournee: l.tour_number }))
    .sort((a, b) => (a.jour + a.heure + a.tournee).localeCompare(b.jour + b.heure + b.tournee, "fr", { numeric: true }));
}

export interface AffectationAbsente extends CaseBandeau {
  nom: string;
  raison: RaisonAbsence;
  du: string | null;
  au: string | null;
}

/**
 * Chauffeurs affectés alors qu'ils sont absents (congé approuvé ou arrêt apparu
 * après la génération) : à remplacer avant l'envoi. Jamais de motif.
 */
export function affectationsDeChauffeursAbsents(lignes: readonly LigneBandeau[], contexte: ContexteAbsences): AffectationAbsente[] {
  const out: AffectationAbsente[] = [];
  for (const l of lignes) {
    if (l.status !== "planned" || l.tour_open === false || l.fusionnee || !l.driver_id) continue;
    const jour = jourDe(l.start_at);
    const a = estAbsentOuInactif(l.driver_id, jour, contexte);
    if (!a || a.raison === "conge_demande") continue;
    out.push({ entree_id: l.id, jour, heure: heureDe(l.start_at), tournee: l.tour_number, nom: l.nom_chauffeur?.trim() || "Chauffeur", raison: a.raison, du: a.du, au: a.au });
  }
  return out.sort((a, b) => (a.jour + a.heure).localeCompare(b.jour + b.heure));
}

/** Semaine (service, lundi) d'une affectation : clé de repérage du suivi. */
export const cleSuivi = (serviceId: string, startAt: string) => cleSemaine(serviceId, lundiDe(jourDe(startAt)));

// ---------------------------------------------------------------------------
// Résumés : recalcul après insertion, cumul d'une régénération.
// ---------------------------------------------------------------------------

/**
 * Résumé des lignes réellement créées (une insertion concurrente peut en avoir
 * ignoré) : `inserees` = clés « tournée|instant » créées ; `absents` doit avoir
 * été relié à `entree_id` avant l'appel.
 */
export function resumeDesLignes(
  lignes: readonly LigneAGenerer[],
  absents: readonly CaseAbsente[],
  base: Pick<ResumeSemaine, "fermees" | "conflits" | "deja_presentes"> & { fusionnees?: number },
): ResumeSemaine {
  const sansChauffeurModeles = lignes.filter((l) => l.origine === "modele").length;
  return {
    tournees: lignes.length,
    chauffeurs: new Set(lignes.map((l) => l.driver_id).filter((id): id is string => Boolean(id))).size,
    a_remplacer: absents.length + sansChauffeurModeles,
    sans_chauffeur_modeles: sansChauffeurModeles,
    fermees: base.fermees,
    conflits: base.conflits,
    deja_presentes: base.deja_presentes,
    fusionnees: base.fusionnees ?? 0,
    absents: [...absents],
  };
}

/** Clé d'une ligne créée, pour la relier à son identifiant après l'insertion. */
export const cleLigne = (tournee: string, startAt: string) => `${tournee}|${Date.parse(startAt)}`;

/** Régénération des cases vides : les compteurs s'ajoutent, sauf les cases fermées et les conflits, relus du dernier plan. */
export function cumulerResumes(avant: ResumeSemaine, ajout: ResumeSemaine): ResumeSemaine {
  return {
    tournees: avant.tournees + ajout.tournees,
    chauffeurs: avant.chauffeurs + ajout.chauffeurs,
    a_remplacer: avant.a_remplacer + ajout.a_remplacer,
    sans_chauffeur_modeles: avant.sans_chauffeur_modeles + ajout.sans_chauffeur_modeles,
    fermees: Math.max(avant.fermees, ajout.fermees),
    conflits: Math.max(avant.conflits, ajout.conflits),
    deja_presentes: ajout.deja_presentes,
    fusionnees: Math.max(avant.fusionnees, ajout.fusionnees),
    absents: [...avant.absents, ...ajout.absents],
  };
}

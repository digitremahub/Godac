/**
 * Comptes d'essai et suspension (back-office GODAC) : logique PURE, sans
 * base ni réseau, importable côté client et testée dans
 * lib/comptes-essai/__tests__.
 *
 *  - état d'un compte (suspendu, abonné, essai en cours / terminé) ;
 *  - filtres, recherche et tri de la liste ;
 *  - règles des actions du staff (suspendre, rétablir, révoquer, terminer
 *    l'essai) : démo jamais touchée, organisation du staff = confirmation
 *    renforcée, motif obligatoire ;
 *  - validation du corps des requêtes.
 *
 * Lectures en base : lib/comptes-essai/serveur.ts ; écritures :
 * lib/comptes-essai/actions.ts.
 */
import { z } from "zod";
import { essaiTermine, estOffreGoNavigation, joursRestants } from "@/lib/go-navigation/offre";

// ── Suspension ──────────────────────────────────────────────────────

export const MOTIF_MIN = 5;
export const MOTIF_MAX = 500;

/** Message affiché (écran et réponses d'API) à tout utilisateur d'un compte suspendu. */
export const MESSAGE_COMPTE_SUSPENDU = "Compte suspendu par GODAC. L'accès de tous les utilisateurs de votre organisation est interrompu ; vos données sont conservées.";

export interface EtatSuspensionOrg {
  suspendue_le?: string | Date | null;
}

/** Compte suspendu : date de suspension posée et valide. */
export function estSuspendue(org: EtatSuspensionOrg | null | undefined): boolean {
  const v = org?.suspendue_le;
  if (!v) return false;
  return Number.isFinite(typeof v === "string" ? Date.parse(v) : v.getTime());
}

/** Motif : espaces normalisés ; null s'il est trop court (ou absent). */
export function normaliserMotif(motif: unknown): string | null {
  if (typeof motif !== "string") return null;
  const m = motif.replace(/\s+/g, " ").trim().slice(0, MOTIF_MAX);
  return m.length >= MOTIF_MIN ? m : null;
}

// ── État d'un compte ────────────────────────────────────────────────

export type StatutCompte = "essai_en_cours" | "essai_termine" | "suspendu" | "abonne" | "autre";

export const LIBELLES_STATUT_COMPTE: Record<StatutCompte, string> = {
  essai_en_cours: "Essai en cours",
  essai_termine: "Essai terminé",
  suspendu: "Suspendu",
  abonne: "Abonné",
  autre: "Autre statut",
};

const goNav = (org: { offre?: string | null }) => estOffreGoNavigation({ offre: org.offre ?? null });

export interface OrgCompte {
  id: string;
  name: string;
  plan?: string | null;
  offre?: string | null;
  subscription_status?: string | null;
  trial_ends_at?: string | null;
  suspendue_le?: string | null;
}

/**
 * Statut unique d'un compte (les filtres de la liste sont disjoints) :
 * suspendu d'abord, puis abonné (abonnement actif), puis essai.
 * Compte GO Navigation : essai terminé = règle de lib/go-navigation/offre.ts
 * (celle qui ferme l'accès). Autres offres : « en essai » (trialing) avec
 * une date de fin dépassée = essai terminé (affichage seulement, aucun effet
 * sur l'accès) ; autres statuts d'abonnement (impayé, résilié…) = « autre ».
 */
export function statutCompte(org: OrgCompte, maintenant: Date = new Date()): StatutCompte {
  if (estSuspendue(org)) return "suspendu";
  if (org.subscription_status === "active") return "abonne";
  if (goNav(org)) return essaiTermine({ offre: org.offre, subscription_status: org.subscription_status, trial_ends_at: org.trial_ends_at }, maintenant) ? "essai_termine" : "essai_en_cours";
  if (org.subscription_status === "trialing") {
    if (org.trial_ends_at) {
      const fin = Date.parse(org.trial_ends_at);
      if (Number.isFinite(fin) && fin <= maintenant.getTime()) return "essai_termine";
    }
    return "essai_en_cours";
  }
  return "autre";
}

/** Jours d'essai restants, ou null hors essai en cours / sans date de fin. */
export function joursEssaiRestants(org: OrgCompte, maintenant: Date = new Date()): number | null {
  if (statutCompte(org, maintenant) !== "essai_en_cours" || !org.trial_ends_at) return null;
  return joursRestants(org.trial_ends_at, maintenant);
}

export type OffreCompte = "go_navigation" | "autre";
export const LIBELLES_OFFRE: Record<OffreCompte, string> = { go_navigation: "GO Navigation", autre: "Autre offre" };

export function offreCompte(org: Pick<OrgCompte, "offre">): OffreCompte {
  return goNav(org) ? "go_navigation" : "autre";
}

// ── Ligne de la liste ───────────────────────────────────────────────

export interface LigneCompte {
  id: string;
  nom: string;
  plan: string | null;
  offre: OffreCompte;
  /** subscription_status brut (trialing, active, past_due, canceled, incomplete). */
  abonnement: string | null;
  statut: StatutCompte;
  trialEndsAt: string | null;
  joursRestants: number | null;
  creeLe: string;
  /** « Jean Dupont (Transports X) » : apporteur / lien de parrainage, s'il existe. */
  apporteur: string | null;
  utilisateursActifs: number;
  emailDirection: string | null;
  /** Dernière connexion ou, à défaut, dernière tournée / arrêt / consommation connus (voir SOURCE_ACTIVITE). */
  derniereActivite: string | null;
  sourceActivite: "connexion" | "activite" | null;
  /** Clés des modules activés (organization_modules.enabled). */
  modules: string[];
  /** Volume sur la fenêtre récente (FENETRE_USAGE_JOURS). */
  tournees: number;
  tourneesDemarrees: number;
  arrets: number;
  arretsLivres: number;
  optimisations: number;
  lecturesEtiquettes: number;
  suspendueLe: string | null;
  suspendueMotif: string | null;
  suspenduePar: string | null;
  /** Organisation de la personne connectée (staff) : actions avec confirmation renforcée. */
  organisationDuStaff: boolean;
}

/** Fenêtre du « volume d'usage récent ». */
export const FENETRE_USAGE_JOURS = 30;

/** Source affichée sous la liste (documentation de la colonne « Dernière activité »). */
export const SOURCE_ACTIVITE =
  "Dernière activité : dernière connexion d'un utilisateur de l'organisation (journal d'authentification), ou, si elle est plus récente, la dernière tournée, le dernier arrêt ou la dernière consommation (lecture d'étiquette, optimisation) des " +
  `${FENETRE_USAGE_JOURS} derniers jours. Aucune donnée n'est ajoutée à la base pour cela.`;

// ── Filtres, recherche, tri ─────────────────────────────────────────

export type FiltreCompte = "tous" | StatutCompte;

export const FILTRES_COMPTE: { cle: FiltreCompte; libelle: string }[] = [
  { cle: "tous", libelle: "Tous" },
  { cle: "essai_en_cours", libelle: "Essai en cours" },
  { cle: "essai_termine", libelle: "Essai terminé" },
  { cle: "suspendu", libelle: "Suspendus" },
  { cle: "abonne", libelle: "Abonnés" },
];

export type TriCompte = "creation_recent" | "nom" | "fin_essai" | "activite_recente" | "activite_ancienne" | "usage";

export const TRIS_COMPTE: { cle: TriCompte; libelle: string }[] = [
  { cle: "creation_recent", libelle: "Création (récents d'abord)" },
  { cle: "nom", libelle: "Nom (A → Z)" },
  { cle: "fin_essai", libelle: "Fin d'essai (la plus proche)" },
  { cle: "activite_recente", libelle: "Dernière activité (récente)" },
  { cle: "activite_ancienne", libelle: "Dernière activité (la plus ancienne)" },
  { cle: "usage", libelle: "Usage récent (arrêts)" },
];

/** Minuscules sans accents, pour la recherche. */
export function normaliserTexte(v: string | null | undefined): string {
  return (v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

export function compterParStatut(lignes: readonly Pick<LigneCompte, "statut">[]): Record<FiltreCompte, number> {
  const r: Record<FiltreCompte, number> = { tous: lignes.length, essai_en_cours: 0, essai_termine: 0, suspendu: 0, abonne: 0, autre: 0 };
  for (const l of lignes) r[l.statut] += 1;
  return r;
}

/** Filtre par statut puis recherche (nom, e-mail de la direction, apporteur ; tous les mots doivent figurer). */
export function filtrerComptes(lignes: readonly LigneCompte[], filtre: FiltreCompte, recherche: string): LigneCompte[] {
  const mots = normaliserTexte(recherche).split(/\s+/).filter(Boolean);
  return lignes.filter((l) => {
    if (filtre !== "tous" && l.statut !== filtre) return false;
    if (mots.length === 0) return true;
    const texte = normaliserTexte(`${l.nom} ${l.emailDirection ?? ""} ${l.apporteur ?? ""}`);
    return mots.every((m) => texte.includes(m));
  });
}

const instant = (v: string | null | undefined): number | null => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

/** Compare deux instants possiblement absents : les absents passent toujours en dernier. */
function comparerInstants(a: number | null, b: number | null, sens: 1 | -1): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * sens;
}

/** Tri stable (nouveau tableau) ; ex æquo départagés par le nom. */
export function trierComptes(lignes: readonly LigneCompte[], tri: TriCompte): LigneCompte[] {
  const parNom = (a: LigneCompte, b: LigneCompte) => a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" });
  const copie = [...lignes];
  switch (tri) {
    case "nom":
      return copie.sort(parNom);
    case "fin_essai":
      // Essais en cours d'abord, par date de fin croissante ; les autres ensuite.
      return copie.sort((a, b) => {
        const ea = a.statut === "essai_en_cours" ? instant(a.trialEndsAt) : null;
        const eb = b.statut === "essai_en_cours" ? instant(b.trialEndsAt) : null;
        return comparerInstants(ea, eb, 1) || parNom(a, b);
      });
    case "activite_recente":
      return copie.sort((a, b) => comparerInstants(instant(a.derniereActivite), instant(b.derniereActivite), -1) || parNom(a, b));
    case "activite_ancienne":
      return copie.sort((a, b) => comparerInstants(instant(a.derniereActivite), instant(b.derniereActivite), 1) || parNom(a, b));
    case "usage":
      return copie.sort((a, b) => b.arrets - a.arrets || b.tournees - a.tournees || parNom(a, b));
    case "creation_recent":
    default:
      return copie.sort((a, b) => comparerInstants(instant(a.creeLe), instant(b.creeLe), -1) || parNom(a, b));
  }
}

// ── Actions du staff ────────────────────────────────────────────────

export const ACTIONS_COMPTE = ["suspendre", "retablir", "revoquer", "terminer_essai"] as const;
export type ActionCompte = (typeof ACTIONS_COMPTE)[number];

export const LIBELLES_ACTION: Record<ActionCompte, string> = {
  suspendre: "Suspendre",
  retablir: "Rétablir",
  revoquer: "Révoquer",
  terminer_essai: "Terminer l'essai maintenant",
};

/** Corps de POST /api/godac-staff/comptes-essai/[id] : motif obligatoire pour toute action (tracé au journal). */
export const corpsActionSchema = z
  .object({
    action: z.enum(ACTIONS_COMPTE),
    motif: z.string().max(2000).optional(),
    /** Nom exact de l'organisation, retapé : confirmation renforcée pour l'organisation du staff. */
    confirmation_nom: z.string().max(300).optional(),
  })
  .refine((v) => normaliserMotif(v.motif) !== null, { path: ["motif"], message: `Indiquez le motif (${MOTIF_MIN} caractères au moins).` });
export type CorpsAction = z.infer<typeof corpsActionSchema>;

export interface OrgAction extends OrgCompte {
  is_demo?: boolean | null;
}

export type VerdictAction = { ok: true } | { ok: false; statut: number; code: string; message: string };

/**
 * Peut-on appliquer l'action sur cette organisation ? (pure)
 *  - organisation de démonstration : jamais ;
 *  - rétablir : seulement un compte suspendu ; suspendre : seulement un compte actif ;
 *  - révoquer : suspend (si ce n'est pas déjà fait) et invalide les invitations, accepté même si déjà suspendu ;
 *  - terminer l'essai : seulement un essai GO Navigation en cours (ni abonné ni déjà terminé) ;
 *  - organisation du staff lui-même : suspendre, révoquer et terminer l'essai exigent le nom exact retapé.
 */
export function verifierAction(action: ActionCompte, org: OrgAction, contexte: { organisationDuStaffId: string | null; confirmationNom?: string | null }, maintenant: Date = new Date()): VerdictAction {
  const refus = (statut: number, code: string, message: string): VerdictAction => ({ ok: false, statut, code, message });
  if (org.is_demo) return refus(409, "ORGANISATION_DEMO", "Une organisation de démonstration n'est jamais concernée par cette action.");
  const suspendue = estSuspendue(org);
  if (action === "suspendre" && suspendue) return refus(409, "DEJA_SUSPENDU", "Ce compte est déjà suspendu.");
  if (action === "retablir" && !suspendue) return refus(409, "PAS_SUSPENDU", "Ce compte n'est pas suspendu.");
  if (action === "terminer_essai") {
    if (!goNav(org)) return refus(409, "PAS_UN_ESSAI_GO", "Seul un compte d'essai GO Navigation peut voir son essai terminé ici.");
    if (org.subscription_status === "active") return refus(409, "DEJA_ABONNE", "Ce compte a un abonnement actif : il n'a pas d'essai à terminer.");
    if (statutEssaiGo(org, maintenant) === "termine") return refus(409, "ESSAI_DEJA_TERMINE", "L'essai de ce compte est déjà terminé.");
  }
  if (action !== "retablir" && contexte.organisationDuStaffId && org.id === contexte.organisationDuStaffId) {
    if ((contexte.confirmationNom ?? "").trim() !== org.name.trim()) {
      return refus(409, "CONFIRMATION_RENFORCEE", "C'est votre propre organisation : saisissez son nom exact pour confirmer.");
    }
  }
  return { ok: true };
}

function statutEssaiGo(org: OrgCompte, maintenant: Date): "termine" | "en_cours" {
  return essaiTermine({ offre: org.offre, subscription_status: org.subscription_status, trial_ends_at: org.trial_ends_at }, maintenant) ? "termine" : "en_cours";
}

/** Actions que la fiche d'un compte propose (boutons), selon son état. Démo : aucune. */
export function actionsProposees(ligne: Pick<LigneCompte, "statut" | "offre" | "abonnement" | "suspendueLe">, estDemo = false): ActionCompte[] {
  if (estDemo) return [];
  if (ligne.statut === "suspendu") return ["retablir", "revoquer"];
  const actions: ActionCompte[] = ["suspendre", "revoquer"];
  if (ligne.offre === "go_navigation" && ligne.statut === "essai_en_cours") actions.push("terminer_essai");
  return actions;
}

/** Texte de confirmation de chaque action (boîte de confirmation maison). */
export function textesConfirmation(action: ActionCompte, nom: string): { titre: string; message: string; action: string; danger: boolean } {
  switch (action) {
    case "suspendre":
      return { titre: `Suspendre « ${nom} » ?`, message: "Tous les utilisateurs de l'organisation perdent l'accès immédiatement (au prochain appel). Aucune donnée n'est supprimée. Vous pourrez rétablir le compte à tout moment.", action: "Suspendre", danger: true };
    case "retablir":
      return { titre: `Rétablir « ${nom} » ?`, message: "Les utilisateurs de l'organisation retrouvent leur accès.", action: "Rétablir", danger: false };
    case "revoquer":
      return {
        titre: `Révoquer « ${nom} » ?`,
        message: "Le compte est suspendu et ses invitations « Faire essayer GO » non utilisées ainsi que son lien personnel sont invalidés. Aucune donnée n'est supprimée.",
        action: "Révoquer",
        danger: true,
      };
    case "terminer_essai":
      return { titre: `Terminer l'essai de « ${nom} » ?`, message: "L'essai prend fin maintenant : les utilisateurs voient l'écran « Essai terminé ». Les données sont conservées ; vous pourrez passer le compte sur une vraie offre.", action: "Terminer l'essai", danger: true };
  }
}

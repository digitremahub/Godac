/**
 * Offre d'essai « GO Navigation » : inscription sur invitation (lien
 * unique généré par le staff GODAC), organisation limitée à la Tournée
 * colis et à la navigation chauffeur, 30 jours d'essai, plafonds stricts.
 *
 * Logique pure (sans base, sans crypto) : importable côté client et testée
 * dans lib/go-navigation/__tests__. Jeton : lib/go-navigation/jeton.ts ;
 * côté serveur : lib/go-navigation/serveur.ts.
 */
import { z } from "zod";

/** Valeur de `organizations.offre` des comptes d'essai GO Navigation. */
export const OFFRE_GO_NAVIGATION = "go_navigation";

/** Durée de l'essai (décision client du 20/10/2026). */
export const DUREE_ESSAI_JOURS = 30;

/** Durée pendant laquelle un lien d'invitation peut être utilisé. */
export const VALIDITE_INVITATION_JOURS = 30;

/**
 * Modules activés à l'inscription. La lecture d'étiquette
 * (app/api/colis/etiquette) ne dépend que de `route_optimizer` (pas du
 * module OCR des tickets carburant) ; `mobile_app` est la clé catalogue de
 * l'appli chauffeur ; `alerts` et `auth_onboarding` sont des modules socle.
 */
export const MODULES_GO_NAVIGATION = ["route_optimizer", "mobile_app", "alerts", "auth_onboarding"] as const;

/**
 * Plafonds mensuels de l'essai, sans dépassement facturé :
 *  - lectures d'étiquettes : le client fait ~100 colis/jour → 3 000/mois ;
 *  - optimisations de tournée : 300/mois.
 * Les scans de codes-barres ne consomment rien. Le plafond journalier de
 * sécurité laisse une grosse journée passer (≈ 5× la moyenne).
 */
export const PLAFONDS_ESSAI = [
  { feature: "ocr_label", included_per_month: 3000, daily_cap: 500 },
  { feature: "route_optimization", included_per_month: 300, daily_cap: 60 },
] as const;

/** Nom du service créé pour le compte (dépôt vide, à renseigner plus tard). */
export const NOM_SERVICE_GO_NAVIGATION = "GO Navigation";

/**
 * Écrans du catalogue d'accès (lib/acces/catalogue.ts) ouverts aux comptes
 * GO Navigation : Tournée colis (préparation, « Ma tournée colis » et
 * historique), GO Navigation, Mon compte, Aide.
 */
export const ECRANS_GO_NAVIGATION: readonly string[] = ["exploitation.colis", "moi.tournee_colis", "exploitation.go_navigation", "exploitation.historique_colis", "aide.guide", "aide.faq", "aide.compte"];

/** Page d'arrivée des comptes GO Navigation (menu réduit, accueil). */
export const ACCUEIL_GO_NAVIGATION = "/exploitation/colis";

export const MESSAGE_ESSAI_TERMINE = "Essai GO Navigation terminé. Contactez GODAC pour continuer à utiliser l'application.";

const JOUR_MS = 24 * 3600 * 1000;

/** Fin de l'essai : maintenant + 30 jours. */
export function finEssai(maintenant: Date = new Date(), jours: number = DUREE_ESSAI_JOURS): Date {
  return new Date(maintenant.getTime() + jours * JOUR_MS);
}

/** Expiration d'un lien d'invitation créé maintenant. */
export function expirationInvitation(maintenant: Date = new Date(), jours: number = VALIDITE_INVITATION_JOURS): Date {
  return new Date(maintenant.getTime() + jours * JOUR_MS);
}

export interface EtatOrganisationOffre {
  offre: string | null | undefined;
  subscription_status: string | null | undefined;
  trial_ends_at: string | Date | null | undefined;
}

export function estOffreGoNavigation(org: Pick<EtatOrganisationOffre, "offre"> | null | undefined): boolean {
  return org?.offre === OFFRE_GO_NAVIGATION;
}

/**
 * Essai GO Navigation terminé : compte GO Navigation pas encore passé sur
 * une vraie offre (abonnement actif) et date de fin dépassée. Fin d'essai
 * absente → considéré terminé (on ne laisse pas un accès illimité par
 * oubli). Sans effet sur les autres organisations.
 */
export function essaiTermine(org: EtatOrganisationOffre | null | undefined, maintenant: Date = new Date()): boolean {
  if (!org || !estOffreGoNavigation(org)) return false;
  if (org.subscription_status === "active") return false;
  if (!org.trial_ends_at) return true;
  const fin = typeof org.trial_ends_at === "string" ? Date.parse(org.trial_ends_at) : org.trial_ends_at.getTime();
  return !Number.isFinite(fin) || fin <= maintenant.getTime();
}

/** Jours d'essai restants (arrondis au supérieur, 0 si terminé). */
export function joursRestants(trialEndsAt: string | Date | null | undefined, maintenant: Date = new Date()): number {
  if (!trialEndsAt) return 0;
  const fin = typeof trialEndsAt === "string" ? Date.parse(trialEndsAt) : trialEndsAt.getTime();
  if (!Number.isFinite(fin)) return 0;
  return Math.max(0, Math.ceil((fin - maintenant.getTime()) / JOUR_MS));
}

// ── Invitations ─────────────────────────────────────────────────────

export interface LigneInvitation {
  expires_at: string | Date;
  used_at: string | Date | null;
  revoked_at: string | Date | null;
}

export type StatutInvitation = "envoyee" | "utilisee" | "expiree" | "revoquee";

export const LIBELLES_STATUT_INVITATION: Record<StatutInvitation, string> = {
  envoyee: "Envoyée",
  utilisee: "Utilisée",
  expiree: "Expirée",
  revoquee: "Révoquée",
};

const instant = (v: string | Date) => (typeof v === "string" ? Date.parse(v) : v.getTime());

/** Statut affiché au staff. Une invitation utilisée le reste, même révoquée ou expirée ensuite. */
export function statutInvitation(inv: LigneInvitation, maintenant: Date = new Date()): StatutInvitation {
  if (inv.used_at) return "utilisee";
  if (inv.revoked_at) return "revoquee";
  const fin = instant(inv.expires_at);
  if (!Number.isFinite(fin) || fin <= maintenant.getTime()) return "expiree";
  return "envoyee";
}

/** Le lien peut encore servir à s'inscrire. */
export function invitationUtilisable(inv: LigneInvitation | null | undefined, maintenant: Date = new Date()): boolean {
  return Boolean(inv) && statutInvitation(inv!, maintenant) === "envoyee";
}

// ── Formulaire d'inscription ────────────────────────────────────────

export const formulaireInscriptionSchema = z.object({
  jeton: z.string().min(1).max(100),
  prenom: z.string().trim().min(1, "Indiquez votre prénom.").max(80),
  nom: z.string().trim().min(1, "Indiquez votre nom.").max(80),
  email: z.string().trim().toLowerCase().email("Adresse e-mail invalide.").max(254),
  motDePasse: z.string().min(10, "Mot de passe : 10 caractères minimum.").max(128),
  cgu: z.literal(true, { errorMap: () => ({ message: "Vous devez accepter les conditions générales d'utilisation." }) }),
});
export type FormulaireInscription = z.infer<typeof formulaireInscriptionSchema>;

/** « GO Navigation – Jean Dupont » (limité à 120 caractères). */
export function nomOrganisation(prenom: string, nom: string): string {
  return `GO Navigation – ${`${prenom.trim()} ${nom.trim()}`.trim()}`.slice(0, 120);
}

/** Note libre du staff : espaces normalisés, 200 caractères maximum. */
export function normaliserNote(note: unknown): string | null {
  if (typeof note !== "string") return null;
  const n = note.replace(/\s+/g, " ").trim().slice(0, 200);
  return n || null;
}

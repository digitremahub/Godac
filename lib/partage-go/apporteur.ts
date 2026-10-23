/**
 * « Faire essayer GO » : suivi d'apporteur. Logique pure (sans base, sans
 * crypto), importable côté client et testée dans lib/partage-go/__tests__.
 * Côté serveur : lib/partage-go/serveur.ts ; jeton : lib/go-navigation/jeton.ts.
 *
 * Pas de calcul de commission : on suit seulement qui a fait essayer GO,
 * combien d'essais sont en cours et combien sont devenus clients payants.
 */
/** Durée de validité d'un lien personnel d'apporteur. */
export const VALIDITE_LIEN_APPORTEUR_JOURS = 90;
/** Inscriptions maximum par lien personnel. */
export const MAX_INSCRIPTIONS_LIEN = 20;
/** Liens et invitations qu'une personne peut créer par 24 h (régénérer un lien compte). */
export const MAX_CREATIONS_PAR_JOUR = 10;

export const MESSAGE_MIGRATION_PARTAGE_GO = "« Faire essayer GO » n'est pas encore disponible sur cette installation (migration 20261103000003_apporteur_go.sql à appliquer).";
export const MESSAGE_DROIT_PARTAGE_GO = "Vous n'avez pas le droit de faire essayer GO. Demandez à la direction de vous l'ouvrir.";

const JOUR_MS = 24 * 3600 * 1000;
const instant = (v: string | Date) => (typeof v === "string" ? Date.parse(v) : v.getTime());

// ── Droit ───────────────────────────────────────────────────────────

export interface ContexteDroitPartage {
  role: string;
  /** users.peut_partager_go : personne désignée par la direction. */
  peutPartager: boolean;
  /** organizations.partage_go_tous : toute l'équipe. */
  partageTous: boolean;
  /** Organisation d'essai GO Navigation : jamais d'apporteur (pas de chaîne de parrainages). */
  offreGoNavigation: boolean;
}

/** La direction a toujours le droit ; les autres s'il est ouvert à leur personne ou à toute l'équipe. */
export function droitPartageGo(c: ContexteDroitPartage): boolean {
  if (c.offreGoNavigation) return false;
  if (c.role === "direction") return true;
  return c.peutPartager || c.partageTous;
}

/** Seule la direction désigne les personnes autorisées. */
export function peutGererDroitsPartage(role: string): boolean {
  return role === "direction";
}

// ── Limites ─────────────────────────────────────────────────────────

/** Nombre de créations (liens + invitations) sur 24 h déjà atteint. */
export function limiteCreationAtteinte(creationsSur24h: number, max: number = MAX_CREATIONS_PAR_JOUR): boolean {
  return creationsSur24h >= max;
}

export function expirationLienApporteur(maintenant: Date = new Date(), jours: number = VALIDITE_LIEN_APPORTEUR_JOURS): Date {
  return new Date(maintenant.getTime() + jours * JOUR_MS);
}

// ── Lien personnel ──────────────────────────────────────────────────

export interface LigneLien {
  expires_at: string | Date;
  revoked_at: string | Date | null;
  max_inscriptions: number;
}

export type StatutLien = "actif" | "complet" | "expire" | "revoque";

export const LIBELLES_STATUT_LIEN: Record<StatutLien, string> = {
  actif: "Actif",
  complet: "Complet",
  expire: "Expiré",
  revoque: "Révoqué",
};

/** `inscrits` : inscriptions déjà prises par ce lien (hors tentatives abandonnées). */
export function statutLien(lien: LigneLien, inscrits: number, maintenant: Date = new Date()): StatutLien {
  if (lien.revoked_at) return "revoque";
  const fin = instant(lien.expires_at);
  if (!Number.isFinite(fin) || fin <= maintenant.getTime()) return "expire";
  if (inscrits >= lien.max_inscriptions) return "complet";
  return "actif";
}

export function lienUtilisable(lien: LigneLien | null | undefined, inscrits: number, maintenant: Date = new Date()): boolean {
  return Boolean(lien) && statutLien(lien!, inscrits, maintenant) === "actif";
}

/** Le nombre d'inscriptions retenues dépasse le maximum après réservation : la dernière doit être annulée. */
export function depasseMaxInscriptions(inscritsApresReservation: number, max: number): boolean {
  return inscritsApresReservation > max;
}

// ── Attribution ─────────────────────────────────────────────────────

/** Ce que mémorise la nouvelle organisation d'essai. Tout à null = invitation du staff GODAC (aucun apporteur). */
export interface Attribution {
  referred_by_user_id: string | null;
  referred_by_org_id: string | null;
  referral_link_id: string | null;
}

export const SANS_APPORTEUR: Attribution = { referred_by_user_id: null, referred_by_org_id: null, referral_link_id: null };

export interface SourceAttribution {
  created_by_user_id?: string | null;
  created_by_org_id?: string | null;
  referral_link_id?: string | null;
}

/**
 * Attribution posée côté serveur à partir de l'invitation ou du lien
 * retrouvé par son jeton (jamais depuis un paramètre du client). Un
 * apporteur sans organisation n'est pas retenu : on garde tout ou rien.
 */
export function attributionDepuis(source: SourceAttribution | null | undefined): Attribution {
  const user = source?.created_by_user_id ?? null;
  const org = source?.created_by_org_id ?? null;
  if (!user || !org) return SANS_APPORTEUR;
  return { referred_by_user_id: user, referred_by_org_id: org, referral_link_id: source?.referral_link_id ?? null };
}

export function aUnApporteur(a: Attribution): boolean {
  return a.referred_by_user_id !== null;
}

// ── Statut d'un invité ──────────────────────────────────────────────

export interface LigneInvite {
  expires_at: string | Date;
  used_at: string | Date | null;
  revoked_at: string | Date | null;
}

export interface OrganisationInvitee {
  offre?: string | null;
  subscription_status?: string | null;
  trial_ends_at?: string | Date | null;
}

export type StatutInvite = "envoyee" | "essai_en_cours" | "essai_termine" | "abonnee" | "expiree" | "revoquee";

export const LIBELLES_STATUT_INVITE: Record<StatutInvite, string> = {
  envoyee: "Envoyée",
  essai_en_cours: "Essai en cours",
  essai_termine: "Essai terminé",
  abonnee: "Abonnée",
  expiree: "Expirée",
  revoquee: "Révoquée",
};

/** Abonnement payant actif : l'organisation d'essai est devenue cliente. */
export function estAbonnee(org: OrganisationInvitee | null | undefined): boolean {
  return org?.subscription_status === "active";
}

export type StatutCompte = "essai_en_cours" | "essai_termine" | "abonnee";

/**
 * Statut d'un compte d'essai créé : abonnée dès qu'un abonnement actif existe
 * (= client payant), sinon essai en cours tant que la fin d'essai n'est pas
 * dépassée. Organisation sans date de fin d'essai : terminée (comme
 * essaiTermine, lib/go-navigation/offre.ts).
 */
export function statutCompte(org: OrganisationInvitee, maintenant: Date = new Date()): StatutCompte {
  if (estAbonnee(org)) return "abonnee";
  const fin = org.trial_ends_at ? instant(org.trial_ends_at) : NaN;
  return Number.isFinite(fin) && fin > maintenant.getTime() ? "essai_en_cours" : "essai_termine";
}

/**
 * Statut vu par l'apporteur : envoyée (pas encore utilisée) → essai en cours
 * → essai terminé, ou abonnée dès qu'un abonnement actif existe. Une
 * invitation utilisée dont l'organisation n'est pas lisible reste « essai
 * en cours ».
 */
export function statutInvite(inv: LigneInvite, org: OrganisationInvitee | null | undefined, maintenant: Date = new Date()): StatutInvite {
  if (inv.used_at) return org ? statutCompte(org, maintenant) : "essai_en_cours";
  if (inv.revoked_at) return "revoquee";
  const fin = instant(inv.expires_at);
  if (!Number.isFinite(fin) || fin <= maintenant.getTime()) return "expiree";
  return "envoyee";
}

export interface ResumeApporteur {
  inscrits: number;
  essaisEnCours: number;
  essaisTermines: number;
  abonnes: number;
}

export const RESUME_VIDE: ResumeApporteur = { inscrits: 0, essaisEnCours: 0, essaisTermines: 0, abonnes: 0 };

/** Cumule des statuts d'invités : « inscrits » = comptes d'essai créés (hors invitations en attente, expirées ou révoquées). */
export function resumerStatuts(statuts: readonly StatutInvite[]): ResumeApporteur {
  const r = { ...RESUME_VIDE };
  for (const s of statuts) {
    if (s === "essai_en_cours") r.essaisEnCours += 1;
    else if (s === "essai_termine") r.essaisTermines += 1;
    else if (s === "abonnee") r.abonnes += 1;
    else continue;
    r.inscrits += 1;
  }
  return r;
}

export interface LigneParApporteur extends ResumeApporteur {
  cle: string;
  nom: string;
}

/** Regroupe des comptes d'essai par apporteur (clé = id de la personne), tri : plus d'inscrits d'abord. */
export function regrouperParApporteur(
  comptes: readonly { apporteurId: string; apporteurNom: string; statut: StatutInvite }[],
): LigneParApporteur[] {
  const par = new Map<string, { nom: string; statuts: StatutInvite[] }>();
  for (const c of comptes) {
    const e = par.get(c.apporteurId) ?? { nom: c.apporteurNom, statuts: [] };
    e.statuts.push(c.statut);
    par.set(c.apporteurId, e);
  }
  return [...par.entries()]
    .map(([cle, e]) => ({ cle, nom: e.nom, ...resumerStatuts(e.statuts) }))
    .sort((a, b) => b.inscrits - a.inscrits || a.nom.localeCompare(b.nom, "fr"));
}

// ── Libellés et partage ─────────────────────────────────────────────

/**
 * « Invité par <prénom nom> » : jamais d'e-mail. Un nom qui ressemble à une
 * adresse e-mail est écarté au profit de l'organisation de l'apporteur.
 */
export function libelleApporteur(nom: string | null | undefined, organisation: string | null | undefined): string | null {
  const propre = (v: string | null | undefined) => {
    const t = (v ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    return t && !t.includes("@") ? t : null;
  };
  return propre(nom) ?? propre(organisation);
}

export function texteInvite(libelle: string | null): string {
  return libelle ? `Invité par ${libelle}` : "";
}

/** Texte court (français) à envoyer avec le lien. */
export function messagePartage(url: string, prenom?: string | null): string {
  const qui = prenom?.trim() ? ` de la part de ${prenom.trim()}` : "";
  return `Essayez gratuitement GO Navigation (30 jours), la navigation chauffeur avec votre tournée colis${qui} : ${url}`;
}

export function lienSms(message: string): string {
  return `sms:?&body=${encodeURIComponent(message)}`;
}

export function lienWhatsapp(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

/** Prénom d'un nom complet (premier mot), pour le message de partage. */
export function prenomDe(nomComplet: string | null | undefined): string | null {
  const p = (nomComplet ?? "").trim().split(/\s+/)[0] ?? "";
  return p && !p.includes("@") ? p : null;
}

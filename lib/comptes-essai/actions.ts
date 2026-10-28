import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { journaliser, type ActionAudit } from "@/lib/audit/journal";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { estSuspendue, normaliserMotif, verifierAction, type ActionCompte, type OrgAction } from "@/lib/comptes-essai/regles";

export const MIGRATION_SUSPENSION = "20261116000001_comptes_suspension.sql";

export type ResultatAction =
  | {
      ok: true;
      action: ActionCompte;
      /** Suspension posée par cet appel (faux : déjà suspendu, ou action sans suspension). */
      suspensionPosee: boolean;
      invitationsRevoquees: number;
      liensRevoques: number;
      avertissement?: string;
    }
  | { ok: false; statut: number; code: string; message: string };

const AUDIT: Record<ActionCompte, ActionAudit> = {
  suspendre: "compte_suspendu",
  retablir: "compte_retabli",
  revoquer: "compte_revoque",
  terminer_essai: "essai_termine_staff",
};

type ErreurPg = { code?: string | null; message?: string | null } | null;

async function lireOrganisation(admin: SupabaseClient, id: string, avecSuspension: boolean): Promise<{ org: OrgAction | null; erreur: ErreurPg }> {
  const colonnes = `id, name, plan, offre, subscription_status, trial_ends_at, is_demo${avecSuspension ? ", suspendue_le" : ""}`;
  const { data, error } = await admin.from("organizations").select(colonnes).eq("id", id).maybeSingle();
  return { org: (data as unknown as OrgAction | null) ?? null, erreur: error };
}

/**
 * Applique une action du staff sur une organisation (client service). Les
 * règles (démo, organisation du staff, état) sont revérifiées ici, côté
 * serveur, à chaque appel. Rien n'est supprimé : une suspension pose trois
 * colonnes, la révocation marque des invitations / liens comme révoqués, la
 * fin d'essai avance trial_ends_at. Tout est tracé au journal d'audit.
 */
export async function appliquerAction(
  admin: SupabaseClient,
  p: { action: ActionCompte; organisationId: string; motif: unknown; par: string; organisationDuStaffId: string | null; confirmationNom?: string | null; maintenant?: Date },
): Promise<ResultatAction> {
  const maintenant = p.maintenant ?? new Date();
  const motif = normaliserMotif(p.motif);
  if (!motif) return { ok: false, statut: 400, code: "MOTIF_REQUIS", message: "Indiquez le motif (5 caractères au moins)." };
  const par = p.par.toLowerCase();
  const manquante = { ok: false as const, statut: 409, code: "MIGRATION_MANQUANTE", message: `Migration ${MIGRATION_SUSPENSION} pas encore appliquée.` };
  const toucheSuspension = p.action !== "terminer_essai";

  let { org, erreur } = await lireOrganisation(admin, p.organisationId, true);
  if (erreur && estSchemaManquant(erreur)) {
    if (toucheSuspension) return manquante;
    ({ org, erreur } = await lireOrganisation(admin, p.organisationId, false));
  }
  if (erreur) {
    console.error("compte (staff) : lecture de l'organisation", erreur.message);
    return { ok: false, statut: 500, code: "ERREUR", message: "Lecture du compte impossible." };
  }
  if (!org) return { ok: false, statut: 404, code: "INTROUVABLE", message: "Organisation introuvable." };

  const verdict = verifierAction(p.action, org, { organisationDuStaffId: p.organisationDuStaffId, confirmationNom: p.confirmationNom }, maintenant);
  if (!verdict.ok) return verdict;

  const maj = async (table: string, valeurs: Record<string, unknown>, filtre: (q: any) => any): Promise<{ lignes: number; erreur: ErreurPg }> => {
    const { data, error } = await filtre(admin.from(table).update(valeurs)).select("id");
    return { lignes: Array.isArray(data) ? data.length : 0, erreur: error ?? null };
  };
  const echec = (e: NonNullable<ErreurPg>, contexte: string): ResultatAction => {
    if (estSchemaManquant(e)) return manquante;
    console.error(`compte (staff) : ${contexte}`, e.message);
    return { ok: false, statut: 500, code: "ERREUR", message: "Modification impossible." };
  };

  let suspensionPosee = false;
  let invitationsRevoquees = 0;
  let liensRevoques = 0;
  let avertissement: string | undefined;
  let details: Record<string, unknown> = { motif, par, organisation: org.name };

  if (p.action === "suspendre" || (p.action === "revoquer" && !estSuspendue(org))) {
    const r = await maj("organizations", { suspendue_le: maintenant.toISOString(), suspendue_motif: motif, suspendue_par: par }, (q) => q.eq("id", org!.id).is("suspendue_le", null));
    if (r.erreur) return echec(r.erreur, "suspension");
    if (r.lignes === 0) return { ok: false, statut: 409, code: "DEJA_SUSPENDU", message: "Ce compte est déjà suspendu." };
    suspensionPosee = true;
  }

  if (p.action === "retablir") {
    const r = await maj("organizations", { suspendue_le: null, suspendue_motif: null, suspendue_par: null }, (q) => q.eq("id", org!.id).not("suspendue_le", "is", null));
    if (r.erreur) return echec(r.erreur, "rétablissement");
    if (r.lignes === 0) return { ok: false, statut: 409, code: "PAS_SUSPENDU", message: "Ce compte n'est pas suspendu." };
    details = { ...details, suspendue_depuis: null };
  }

  if (p.action === "revoquer") {
    const horodatage = maintenant.toISOString();
    const inv = await maj("go_navigation_invitations", { revoked_at: horodatage, revoked_by_email: par }, (q) => q.eq("created_by_org_id", org!.id).is("used_at", null).is("revoked_at", null));
    if (inv.erreur) {
      // Table ou colonne absente (offre de partage pas installée) : rien à révoquer.
      if (!estSchemaManquant(inv.erreur)) {
        console.error("compte (staff) : révocation des invitations", inv.erreur.message);
        avertissement = "Le compte est suspendu mais ses invitations n'ont pas pu être toutes révoquées : recommencez « Révoquer ».";
      }
    } else invitationsRevoquees = inv.lignes;
    const liens = await maj("go_apporteur_liens", { revoked_at: horodatage }, (q) => q.eq("organization_id", org!.id).is("revoked_at", null));
    if (liens.erreur) {
      if (!estSchemaManquant(liens.erreur)) {
        console.error("compte (staff) : révocation des liens personnels", liens.erreur.message);
        avertissement = "Le compte est suspendu mais ses liens personnels n'ont pas pu être tous révoqués : recommencez « Révoquer ».";
      }
    } else liensRevoques = liens.lignes;
    details = { ...details, suspension_posee: suspensionPosee, invitations_revoquees: invitationsRevoquees, liens_revoques: liensRevoques };
  }

  if (p.action === "terminer_essai") {
    const r = await maj("organizations", { trial_ends_at: maintenant.toISOString() }, (q) => q.eq("id", org!.id).eq("offre", "go_navigation").neq("subscription_status", "active"));
    if (r.erreur) return echec(r.erreur, "fin d'essai");
    if (r.lignes === 0) return { ok: false, statut: 409, code: "ESSAI_NON_MODIFIABLE", message: "L'essai n'a pas pu être terminé (compte passé sur une offre entre-temps ?)." };
    details = { ...details, ancienne_fin: org.trial_ends_at ?? null };
  }

  if (p.organisationDuStaffId && org.id === p.organisationDuStaffId) details = { ...details, organisation_du_staff: true };
  await journaliser({ organizationId: org.id, userId: null, action: AUDIT[p.action], targetTable: "organizations", targetId: org.id, details });
  return { ok: true, action: p.action, suspensionPosee, invitationsRevoquees, liensRevoques, ...(avertissement ? { avertissement } : {}) };
}

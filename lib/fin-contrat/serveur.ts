import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { journaliser } from "@/lib/audit/journal";
import { sendTransactionalEmail } from "@/lib/email/resend";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { enLots } from "@/lib/retention/photos";
import { messagePreavis } from "@/lib/fin-contrat/message";
import { listerFichiers } from "@/lib/fin-contrat/stockage";
import {
  ACTIONS_AUDIT_CONSERVEES,
  BUCKETS_PAR_ORGANISATION,
  COLONNES_FIN_CONTRAT,
  champsFinContratStripe,
  dateFinContrat,
  decider,
  ligneJournal,
  planifier,
  purgeActive,
  type AbonnementStripeMinimal,
  type ActionPlanifiee,
  type OrganisationFinContrat,
} from "@/lib/fin-contrat/regles";

export interface BilanFinContrat {
  mode: "actif" | "dry-run";
  examinees: number;
  preavis: string[];
  preavisSimules: string[];
  suppressions: string[];
  suppressionsSimulees: string[];
  reportees: string[];
  bloquees: string[];
  comptesRepris: number;
  erreurs: string[];
  /** Colonnes absentes : migration 20261112000001 pas appliquée, rien n'a été fait. */
  migrationAbsente?: boolean;
}

/** E-mails de la direction de l'organisation (comptes actifs d'abord ; à défaut, tous les comptes direction). */
async function contactsOrganisation(admin: SupabaseClient, organizationId: string): Promise<string[]> {
  const { data, error } = await admin.from("users").select("email, active").eq("organization_id", organizationId).eq("role", "direction");
  if (error) throw new Error(`contacts : ${error.message}`);
  const lignes = ((data ?? []) as { email: string | null; active: boolean | null }[]).filter((u) => u.email && u.email.includes("@"));
  const actifs = lignes.filter((u) => u.active !== false);
  const choisis = (actifs.length > 0 ? actifs : lignes).map((u) => u.email!.trim().toLowerCase());
  return [...new Set(choisis)];
}

async function envoyerPreavis(admin: SupabaseClient, org: OrganisationFinContrat, suppressionPrevue: Date, maintenant: Date): Promise<void> {
  const fin = dateFinContrat(org);
  if (!fin) throw new Error("date de fin inconnue");
  const contacts = await contactsOrganisation(admin, org.id);
  if (contacts.length === 0) throw new Error("aucun contact : pas de compte direction avec e-mail (préavis non envoyé, suppression impossible)");
  const { subject, html } = messagePreavis({ nomOrganisation: org.name, finContrat: fin, suppressionPrevue });
  const envoi = await sendTransactionalEmail({ to: contacts, subject, html });
  if (!envoi.sent) throw new Error(`e-mail non envoyé : ${envoi.reason ?? "raison inconnue"}`);
  const { error } = await admin.from("organizations").update({ suppression_preavis_envoye_le: maintenant.toISOString() }).eq("id", org.id).eq("suppression_bloquee", false);
  if (error) throw new Error(`préavis envoyé mais non enregistré : ${error.message}`);
  await journaliser({
    organizationId: org.id,
    userId: null,
    action: "fin_contrat_preavis",
    targetTable: "organizations",
    targetId: org.id,
    details: { destinataires: contacts.length, suppression_prevue: suppressionPrevue.toISOString().slice(0, 10) },
  });
}

/** Efface tous les fichiers de l'organisation (préfixe `<id>/` de chaque bucket). Lève une erreur au moindre échec : mieux vaut réessayer demain. */
async function supprimerFichiers(admin: SupabaseClient, organizationId: string): Promise<number> {
  let total = 0;
  for (const nom of BUCKETS_PAR_ORGANISATION) {
    const bucket = admin.storage.from(nom);
    let chemins: string[];
    try {
      chemins = await listerFichiers(bucket, organizationId);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (/bucket not found/i.test(message)) continue; // bucket absent de cet environnement
      throw new Error(`lecture de ${nom} : ${message}`);
    }
    for (const lot of enLots(chemins)) {
      const { error } = await bucket.remove(lot);
      if (error) throw new Error(`effacement dans ${nom} : ${error.message}`);
    }
    total += chemins.length;
  }
  return total;
}

async function supprimerComptes(admin: SupabaseClient, organizationId: string, ids: string[]): Promise<number> {
  const restants: string[] = [];
  for (const id of ids) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error && !/not found/i.test(error.message)) restants.push(id);
  }
  const { error } = await admin.from("organisations_supprimees").update({ auth_utilisateurs_restants: restants }).eq("id", organizationId);
  if (error) console.error("fin-contrat : comptes restants non enregistrés", error.message);
  return restants.length;
}

/** Suppression d'une organisation : relecture de l'état, fichiers, base (fonction SQL atomique, qui revérifie tout), comptes de connexion. */
async function supprimerOrganisation(admin: SupabaseClient, organizationId: string, maintenant: Date): Promise<{ fichiers: number; comptesRestants: number }> {
  const { data: frais, error: errLecture } = await admin.from("organizations").select(COLONNES_FIN_CONTRAT).eq("id", organizationId).maybeSingle();
  if (errLecture || !frais) throw new Error(`relecture : ${errLecture?.message ?? "organisation introuvable"}`);
  const d = decider(frais as unknown as OrganisationFinContrat, maintenant);
  if (d.action !== "suppression") throw new Error(`état modifié depuis le début du passage (${d.raison})`);

  const fichiers = await supprimerFichiers(admin, organizationId);
  const { data, error } = await admin.rpc("supprimer_organisation_fin_contrat", { p_org: organizationId, p_actions_conservees: [...ACTIONS_AUDIT_CONSERVEES] });
  if (error) throw new Error(`suppression en base : ${error.message}`);
  const ids = ((data as { utilisateurs?: string[] } | null)?.utilisateurs ?? []).filter((x) => typeof x === "string");
  const comptesRestants = await supprimerComptes(admin, organizationId, ids);
  return { fichiers, comptesRestants };
}

/** Reprise : comptes de connexion restés après une suppression (échec de l'API d'authentification). */
async function reprendreComptes(admin: SupabaseClient): Promise<number> {
  const { data, error } = await admin.from("organisations_supprimees").select("id, auth_utilisateurs_restants").neq("auth_utilisateurs_restants", "{}").limit(20);
  if (error) return 0;
  let repris = 0;
  for (const ligne of (data ?? []) as { id: string; auth_utilisateurs_restants: string[] }[]) {
    const restants = await supprimerComptes(admin, ligne.id, ligne.auth_utilisateurs_restants);
    repris += ligne.auth_utilisateurs_restants.length - restants;
  }
  return repris;
}

/**
 * Passage quotidien. DRY-RUN par défaut : seules les lignes de journal sont écrites
 * (rien n'est envoyé ni supprimé). Avec FIN_CONTRAT_PURGE_ACTIVE=true : envoi des
 * préavis dus et suppression des organisations éligibles (3 au plus par passage).
 */
export async function executerFinContrat(admin: SupabaseClient, maintenant: Date = new Date(), actif: boolean = purgeActive()): Promise<BilanFinContrat> {
  const bilan: BilanFinContrat = {
    mode: actif ? "actif" : "dry-run",
    examinees: 0,
    preavis: [],
    preavisSimules: [],
    suppressions: [],
    suppressionsSimulees: [],
    reportees: [],
    bloquees: [],
    comptesRepris: 0,
    erreurs: [],
  };

  const { data, error } = await admin
    .from("organizations")
    .select(COLONNES_FIN_CONTRAT)
    .eq("is_demo", false)
    .or("contrat_termine_le.not.is.null,offre.eq.go_navigation,subscription_status.eq.canceled")
    .limit(5000);
  if (error) {
    if (estSchemaManquant(error)) {
      bilan.migrationAbsente = true;
      console.warn("fin-contrat : migration 20261112000001 absente, rien n'est fait");
    } else {
      bilan.erreurs.push(`lecture des organisations : ${error.message}`);
    }
    return bilan;
  }

  const orgs = (data ?? []) as unknown as OrganisationFinContrat[];
  bilan.examinees = orgs.length;
  const parId = new Map(orgs.map((o) => [o.id, o]));
  const plan: ActionPlanifiee[] = planifier(orgs, maintenant, actif);

  for (const a of plan) {
    const d = a.decision;
    if (d.action === "aucune" || d.action === "attente") continue;
    console.log(ligneJournal(a, actif));
    if (d.action === "bloquee") {
      bilan.bloquees.push(a.organisationId);
      continue;
    }
    if (d.action === "preavis" && !a.executer) {
      bilan.preavisSimules.push(a.organisationId);
      continue;
    }
    if (d.action === "suppression" && a.reportee) {
      bilan.reportees.push(a.organisationId);
      continue;
    }
    if (d.action === "suppression" && !a.executer) {
      bilan.suppressionsSimulees.push(a.organisationId);
      continue;
    }
    try {
      if (d.action === "preavis") {
        await envoyerPreavis(admin, parId.get(a.organisationId)!, d.suppressionPrevue, maintenant);
        bilan.preavis.push(a.organisationId);
      } else if (d.action === "suppression") {
        const r = await supprimerOrganisation(admin, a.organisationId, maintenant);
        bilan.suppressions.push(a.organisationId);
        console.log(JSON.stringify({ evenement: "fin_contrat", resultat: "SUPPRIMEE", organisation: a.organisationId, fichiers: r.fichiers, comptes_restants: r.comptesRestants }));
      }
    } catch (e) {
      const message = `${a.organisationId} : ${e instanceof Error ? e.message : String(e)}`;
      bilan.erreurs.push(message);
      console.error("fin-contrat", message);
    }
  }

  if (actif) bilan.comptesRepris = await reprendreComptes(admin);
  return bilan;
}

/**
 * Webhook Stripe : enregistre la date de fin de contrat à l'annulation de l'abonnement
 * (une seule fois : la date n'est jamais déplacée), ou l'efface si l'abonnement redevient
 * vivant (réactivation : plus de préavis ni de suppression). Meilleur effort : une erreur
 * (migration pas appliquée) n'empêche jamais le traitement de la facturation.
 */
export async function enregistrerFinContratStripe(admin: SupabaseClient, organizationId: string, subscription: AbonnementStripeMinimal): Promise<void> {
  try {
    const c = champsFinContratStripe(subscription);
    if (c.action === "terminer") {
      const { error } = await admin.from("organizations").update({ contrat_termine_le: c.contrat_termine_le }).eq("id", organizationId).is("contrat_termine_le", null);
      if (error && !estSchemaManquant(error)) console.error("fin de contrat non enregistrée", error.message);
    } else if (c.action === "reactiver") {
      const { error } = await admin.from("organizations").update({ contrat_termine_le: null, suppression_preavis_envoye_le: null }).eq("id", organizationId).not("contrat_termine_le", "is", null);
      if (error && !estSchemaManquant(error)) console.error("fin de contrat non effacée", error.message);
    }
  } catch (e) {
    console.error("fin de contrat (webhook Stripe)", e);
  }
}

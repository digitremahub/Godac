import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { libelleApporteur, statutCompte, type OrganisationInvitee, type StatutCompte } from "@/lib/partage-go/apporteur";

/** Apporteur d'un compte d'essai, tel qu'affiché au staff GODAC (nom + organisation). */
export interface ApporteurStaff {
  userId: string;
  nom: string;
  organisationId: string | null;
  organisation: string | null;
}

export interface ResumeApporteurStaff extends ApporteurStaff {
  inscrits: number;
  enCours: number;
  termines: number;
  /** Convertis en clients payants : organisation d'essai avec un abonnement actif. */
  clients: number;
}

/** Noms des apporteurs et de leurs organisations (client service, staff seulement). */
export async function nomsApporteurs(admin: SupabaseClient, userIds: readonly string[], orgIds: readonly string[]) {
  const users = new Map<string, string>();
  const orgs = new Map<string, string>();
  const ids = [...new Set(userIds)];
  const oids = [...new Set(orgIds)];
  const [u, o] = await Promise.all([
    ids.length ? admin.from("users").select("id, full_name").in("id", ids) : Promise.resolve({ data: [] }),
    oids.length ? admin.from("organizations").select("id, name").in("id", oids) : Promise.resolve({ data: [] }),
  ]);
  for (const r of (u.data ?? []) as unknown as { id: string; full_name: string }[]) users.set(r.id, r.full_name);
  for (const r of (o.data ?? []) as unknown as { id: string; name: string }[]) orgs.set(r.id, r.name);
  return { users, orgs };
}

export function apporteurStaff(userId: string, orgId: string | null, noms: { users: Map<string, string>; orgs: Map<string, string> }): ApporteurStaff {
  return {
    userId,
    // Staff : le nom complet est utile ; on ne montre jamais d'e-mail ici.
    nom: libelleApporteur(noms.users.get(userId), null) ?? "Ancien membre",
    organisationId: orgId,
    organisation: orgId ? (noms.orgs.get(orgId) ?? null) : null,
  };
}

/**
 * Résumé par apporteur à partir des organisations d'essai attribuées
 * (organizations.referred_by_*). Pas de commission : suivi seulement.
 */
export function resumerParApporteurStaff(
  comptes: readonly (OrganisationInvitee & { referred_by_user_id: string; referred_by_org_id: string | null })[],
  noms: { users: Map<string, string>; orgs: Map<string, string> },
  maintenant: Date = new Date(),
): ResumeApporteurStaff[] {
  const par = new Map<string, ResumeApporteurStaff>();
  for (const c of comptes) {
    const r = par.get(c.referred_by_user_id) ?? { ...apporteurStaff(c.referred_by_user_id, c.referred_by_org_id, noms), inscrits: 0, enCours: 0, termines: 0, clients: 0 };
    const s: StatutCompte = statutCompte(c, maintenant);
    r.inscrits += 1;
    if (s === "abonnee") r.clients += 1;
    else if (s === "essai_en_cours") r.enCours += 1;
    else r.termines += 1;
    par.set(c.referred_by_user_id, r);
  }
  return [...par.values()].sort((a, b) => b.inscrits - a.inscrits || a.nom.localeCompare(b.nom, "fr"));
}

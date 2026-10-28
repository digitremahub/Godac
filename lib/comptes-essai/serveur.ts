import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { apporteurStaff, nomsApporteurs } from "@/lib/partage-go/staff";
import { calculerLignes, type ArretBrut, type OrgEssai, type TourneeBrute, type UsageBrut, FEATURE_ETIQUETTE, FEATURE_OPTIMISATION } from "@/lib/go-navigation/usage";
import { lireTout, lots, TAILLE_LOT } from "@/lib/go-navigation/usage-serveur";
import { FENETRE_USAGE_JOURS, offreCompte, statutCompte, joursEssaiRestants, type LigneCompte } from "@/lib/comptes-essai/regles";

/**
 * Lecture (client service, staff GODAC seulement) de TOUTES les organisations
 * hors démonstration pour la page « Comptes d'essai ». Colonnes minimales :
 * jamais d'adresse, de nom ni de téléphone de destinataire (le volume d'usage
 * vient de lib/go-navigation/usage.ts, qui n'en porte aucun).
 *
 * Aucune migration n'est nécessaire pour LIRE : chaque groupe de colonnes
 * récent (suspension, apporteur, offre) est lu avec repli si la migration
 * correspondante n'est pas appliquée.
 */

interface OrgBrute {
  id: string;
  name: string;
  plan?: string | null;
  created_at: string;
  subscription_status?: string | null;
  offre?: string | null;
  trial_ends_at?: string | null;
  referred_by_user_id?: string | null;
  referred_by_org_id?: string | null;
  suspendue_le?: string | null;
  suspendue_motif?: string | null;
  suspendue_par?: string | null;
}

export interface ComptesEssai {
  lignes: LigneCompte[];
  /** La suspension n'est pas encore installée (migration 20261116000001 absente) : lecture seule. */
  suspensionDisponible: boolean;
}

const BASE = "id, name, plan, created_at, subscription_status";

/** Organisations hors démo, en retombant sur moins de colonnes si des migrations manquent. */
async function lireOrganisations(admin: SupabaseClient): Promise<{ orgs: OrgBrute[]; suspension: boolean } | null> {
  const offre = "offre, trial_ends_at";
  const apport = "referred_by_user_id, referred_by_org_id";
  const susp = "suspendue_le, suspendue_motif, suspendue_par";
  const essais: { colonnes: string; suspension: boolean }[] = [
    { colonnes: `${BASE}, ${offre}, ${apport}, ${susp}`, suspension: true },
    { colonnes: `${BASE}, ${offre}, ${apport}`, suspension: false },
    { colonnes: `${BASE}, ${offre}`, suspension: false },
    { colonnes: BASE, suspension: false },
  ];
  for (const essai of essais) {
    const orgs: OrgBrute[] = [];
    let erreur: { code?: string | null; message?: string | null } | null = null;
    for (let i = 0; i < 100; i++) {
      const { data, error } = await admin.from("organizations").select(essai.colonnes).eq("is_demo", false).order("id").range(i * 1000, (i + 1) * 1000 - 1);
      if (error) {
        erreur = error;
        break;
      }
      const page = (data ?? []) as unknown as OrgBrute[];
      orgs.push(...page);
      if (page.length < 1000) break;
    }
    if (!erreur) return { orgs, suspension: essai.suspension };
    if (!estSchemaManquant(erreur)) {
      console.error("comptes d'essai (organisations)", erreur.message);
      return null;
    }
  }
  return null;
}

interface UtilisateurBrut {
  id: string;
  organization_id: string;
  role: string;
  email: string | null;
  active: boolean | null;
  pending_approval: boolean | null;
  created_at: string | null;
}

/** Dernière connexion (auth) de chaque utilisateur : listUsers pagine par 1000, bien moins coûteux qu'un appel par personne. */
async function connexionsAuth(admin: SupabaseClient): Promise<Map<string, string>> {
  const resultat = new Map<string, string>();
  const parPage = 1000;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: parPage });
    if (error) {
      console.error("comptes d'essai (connexions)", error.message);
      break;
    }
    const utilisateurs = data?.users ?? [];
    for (const u of utilisateurs) if (u.last_sign_in_at) resultat.set(u.id, u.last_sign_in_at);
    if (utilisateurs.length < parPage) break;
  }
  return resultat;
}

/** Liste des comptes, ou null si les organisations sont illisibles. `organisationDuStaffId` : organisation de la personne connectée. */
export async function chargerComptes(admin: SupabaseClient, organisationDuStaffId: string | null, maintenant: Date = new Date()): Promise<ComptesEssai | null> {
  const lues = await lireOrganisations(admin);
  if (!lues) return null;
  const { orgs } = lues;
  const ids = orgs.map((o) => o.id);
  const depuis = new Date(maintenant.getTime() - FENETRE_USAGE_JOURS * 24 * 3600 * 1000).toISOString();

  const utilisateurs: UtilisateurBrut[] = [];
  const modules = new Map<string, string[]>();
  const tournees: TourneeBrute[] = [];
  const arrets: ArretBrut[] = [];
  const usages: UsageBrut[] = [];
  for (const lot of lots(ids, TAILLE_LOT)) {
    const [u, m, t, a, c] = await Promise.all([
      lireTout<UtilisateurBrut>("utilisateurs", (de, fin) => admin.from("users").select("id, organization_id, role, email, active, pending_approval, created_at").in("organization_id", lot).order("id").range(de, fin)),
      lireTout<{ organization_id: string; module_key: string }>("modules", (de, fin) => admin.from("organization_modules").select("organization_id, module_key").in("organization_id", lot).eq("enabled", true).order("organization_id").order("module_key").range(de, fin)),
      lireTout<TourneeBrute>("tournées", (de, fin) => admin.from("delivery_runs").select("id, organization_id, run_date, status, created_at, started_at, optimized_at").in("organization_id", lot).gte("created_at", depuis).order("id").range(de, fin)),
      lireTout<ArretBrut>("arrêts", (de, fin) => admin.from("delivery_stops").select("organization_id, run_id, status, created_at, done_at").in("organization_id", lot).gte("created_at", depuis).order("id").range(de, fin)),
      lireTout<UsageBrut>("consommation", (de, fin) =>
        admin.from("usage_events").select("organization_id, feature, units, created_at").in("organization_id", lot).in("feature", [FEATURE_ETIQUETTE, FEATURE_OPTIMISATION]).gte("created_at", depuis).order("id").range(de, fin),
      ),
    ]);
    utilisateurs.push(...u);
    for (const r of m) modules.set(r.organization_id, [...(modules.get(r.organization_id) ?? []), r.module_key]);
    tournees.push(...t);
    arrets.push(...a);
    usages.push(...c);
  }

  const connexions = await connexionsAuth(admin);
  const actifsParOrg = new Map<string, UtilisateurBrut[]>();
  const connexionParOrg = new Map<string, string>();
  for (const u of utilisateurs) {
    if (u.active !== false && !u.pending_approval) actifsParOrg.set(u.organization_id, [...(actifsParOrg.get(u.organization_id) ?? []), u]);
    const c = connexions.get(u.id);
    const actuelle = connexionParOrg.get(u.organization_id);
    if (c && (!actuelle || Date.parse(c) > Date.parse(actuelle))) connexionParOrg.set(u.organization_id, c);
  }

  const noms = await nomsApporteurs(
    admin,
    orgs.map((o) => o.referred_by_user_id).filter((v): v is string => Boolean(v)),
    orgs.map((o) => o.referred_by_org_id).filter((v): v is string => Boolean(v)),
  );
  const essais: OrgEssai[] = orgs.map((o) => {
    const a = o.referred_by_user_id ? apporteurStaff(o.referred_by_user_id, o.referred_by_org_id ?? null, noms) : null;
    return {
      id: o.id,
      name: o.name,
      created_at: o.created_at,
      trial_ends_at: o.trial_ends_at ?? null,
      subscription_status: o.subscription_status ?? null,
      apporteur: a ? (a.organisation ? `${a.nom} (${a.organisation})` : a.nom) : null,
      derniereConnexionAuth: connexionParOrg.get(o.id) ?? null,
      accordDetail: false,
    };
  });
  const apporteurs = new Map(essais.map((e) => [e.id, e.apporteur]));
  const usage = new Map(calculerLignes(essais, { tournees, arrets, usages, recommandations: new Map() }, maintenant).map((l) => [l.id, l]));

  const lignes: LigneCompte[] = orgs.map((o) => {
    const u = usage.get(o.id)!;
    const actifs = actifsParOrg.get(o.id) ?? [];
    const direction = actifs.filter((x) => x.role === "direction").sort((x, y) => Date.parse(x.created_at ?? "") - Date.parse(y.created_at ?? ""))[0];
    const connexion = connexionParOrg.get(o.id) ?? null;
    return {
      id: o.id,
      nom: o.name,
      plan: o.plan ?? null,
      offre: offreCompte(o),
      abonnement: o.subscription_status ?? null,
      statut: statutCompte(o, maintenant),
      trialEndsAt: o.trial_ends_at ?? null,
      joursRestants: joursEssaiRestants(o, maintenant),
      creeLe: o.created_at,
      apporteur: apporteurs.get(o.id) ?? null,
      utilisateursActifs: actifs.length,
      emailDirection: direction?.email ?? null,
      derniereActivite: u.derniereActivite,
      sourceActivite: u.derniereActivite ? (connexion && connexion === u.derniereActivite ? "connexion" : "activite") : null,
      modules: [...new Set(modules.get(o.id) ?? [])].sort(),
      tournees: u.tourneesCreees,
      tourneesDemarrees: u.tourneesDemarrees,
      arrets: u.arrets,
      arretsLivres: u.arretsLivres,
      optimisations: u.optimisations,
      lecturesEtiquettes: u.lecturesEtiquettes,
      suspendueLe: o.suspendue_le ?? null,
      suspendueMotif: o.suspendue_motif ?? null,
      suspenduePar: o.suspendue_par ?? null,
      organisationDuStaff: organisationDuStaffId !== null && o.id === organisationDuStaffId,
    };
  });
  return { lignes, suspensionDisponible: lues.suspension };
}

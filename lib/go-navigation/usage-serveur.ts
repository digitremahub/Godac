import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { OFFRE_GO_NAVIGATION } from "@/lib/go-navigation/offre";
import { apporteurStaff, nomsApporteurs } from "@/lib/partage-go/staff";
import {
  calculerLignes,
  chronologie,
  detaillerTournees,
  FEATURE_ETIQUETTE,
  FEATURE_OPTIMISATION,
  synthetiser,
  type ArretBrut,
  type EvenementUsage,
  type LigneTournee,
  type LigneUsageEssai,
  type OrgEssai,
  type SyntheseUsage,
  type TourneeBrute,
  type UsageBrut,
} from "@/lib/go-navigation/usage";

/**
 * Lecture (client service, staff GODAC seulement) des données d'usage des
 * comptes d'essai. Colonnes minimales : jamais d'adresse, de nom, de
 * téléphone, de code colis ni de position GPS (voir lib/go-navigation/usage.ts).
 */

const TAILLE_PAGE = 1000;
const PAGES_MAX = 100;
const TAILLE_LOT = 40;

type Page<T> = PromiseLike<{ data: T[] | null; error: { code?: string | null; message?: string | null } | null }>;

/** Lit toutes les pages d'une requête (PostgREST plafonne à 1000 lignes). Erreur (table absente…) : liste vide, consignée. */
async function lireTout<T>(contexte: string, page: (de: number, a: number) => Page<T>): Promise<T[]> {
  const lignes: T[] = [];
  for (let i = 0; i < PAGES_MAX; i++) {
    const { data, error } = await page(i * TAILLE_PAGE, (i + 1) * TAILLE_PAGE - 1);
    if (error) {
      if (!estSchemaManquant(error)) console.error(`usage essais (${contexte})`, error.message);
      return lignes;
    }
    lignes.push(...(data ?? []));
    if ((data ?? []).length < TAILLE_PAGE) break;
  }
  return lignes;
}

function lots<T>(liste: readonly T[], taille: number): T[][] {
  const r: T[][] = [];
  for (let i = 0; i < liste.length; i += taille) r.push(liste.slice(i, i + taille));
  return r;
}

export interface UsageEssais {
  lignes: LigneUsageEssai[];
  synthese: SyntheseUsage;
}

interface OrgBrute {
  id: string;
  name: string;
  created_at: string;
  trial_ends_at: string | null;
  subscription_status: string | null;
  referred_by_user_id?: string | null;
  referred_by_org_id?: string | null;
  partage_usage_detail?: boolean | null;
}

/** Organisations d'essai, en retombant sur moins de colonnes si des migrations manquent. */
async function lireOrganisations(admin: SupabaseClient): Promise<OrgBrute[] | null> {
  const base = "id, name, created_at, trial_ends_at, subscription_status";
  const essais = [`${base}, referred_by_user_id, referred_by_org_id, partage_usage_detail`, `${base}, partage_usage_detail`, `${base}, referred_by_user_id, referred_by_org_id`, base];
  for (const colonnes of essais) {
    const { data, error } = await admin.from("organizations").select(colonnes).eq("offre", OFFRE_GO_NAVIGATION).order("created_at", { ascending: false });
    if (!error) return (data ?? []) as unknown as OrgBrute[];
    if (!estSchemaManquant(error)) {
      console.error("usage essais (organisations)", error.message);
      return null;
    }
  }
  return null;
}

/** Dernière connexion (auth) par organisation : max de last_sign_in_at de ses utilisateurs. */
async function dernieresConnexions(admin: SupabaseClient, orgIds: readonly string[]): Promise<Map<string, string>> {
  const resultat = new Map<string, string>();
  const utilisateurs: { id: string; organization_id: string }[] = [];
  for (const lot of lots(orgIds, TAILLE_LOT)) {
    utilisateurs.push(...(await lireTout<{ id: string; organization_id: string }>("utilisateurs", (de, a) => admin.from("users").select("id, organization_id").in("organization_id", lot).order("id").range(de, a))));
  }
  for (const lot of lots(utilisateurs, 10)) {
    const reponses = await Promise.all(lot.map((u) => admin.auth.admin.getUserById(u.id).then((r) => ({ u, derniere: r.data?.user?.last_sign_in_at ?? null }), () => ({ u, derniere: null }))));
    for (const { u, derniere } of reponses) {
      if (!derniere) continue;
      const actuelle = resultat.get(u.organization_id);
      if (!actuelle || Date.parse(derniere) > Date.parse(actuelle)) resultat.set(u.organization_id, derniere);
    }
  }
  return resultat;
}

/** Tournées et arrêts (colonnes de comptage seulement) des organisations données. */
export async function lireTourneesEtArrets(admin: SupabaseClient, orgIds: readonly string[]): Promise<{ tournees: TourneeBrute[]; arrets: ArretBrut[] }> {
  const tournees: TourneeBrute[] = [];
  const arrets: ArretBrut[] = [];
  for (const lot of lots(orgIds, TAILLE_LOT)) {
    tournees.push(...(await lireTout<TourneeBrute>("tournées", (de, a) => admin.from("delivery_runs").select("id, organization_id, run_date, status, created_at, started_at, optimized_at").in("organization_id", lot).order("id").range(de, a))));
    arrets.push(...(await lireTout<ArretBrut>("arrêts", (de, a) => admin.from("delivery_stops").select("organization_id, run_id, status, created_at, done_at").in("organization_id", lot).order("id").range(de, a))));
  }
  return { tournees, arrets };
}

/** Tableau de bord agrégé de tous les comptes d'essai, ou null si les organisations sont illisibles. */
export async function chargerUsageEssais(admin: SupabaseClient, maintenant: Date = new Date()): Promise<UsageEssais | null> {
  const orgs = await lireOrganisations(admin);
  if (!orgs) return null;
  const ids = orgs.map((o) => o.id);

  const [{ tournees, arrets }, connexions] = await Promise.all([lireTourneesEtArrets(admin, ids), dernieresConnexions(admin, ids)]);

  const usages: UsageBrut[] = [];
  const recommandations = new Map<string, number>();
  for (const lot of lots(ids, TAILLE_LOT)) {
    usages.push(
      ...(await lireTout<UsageBrut>("consommation", (de, a) =>
        admin.from("usage_events").select("organization_id, feature, units, created_at").in("organization_id", lot).in("feature", [FEATURE_ETIQUETTE, FEATURE_OPTIMISATION]).order("id").range(de, a),
      )),
    );
    const refs = await lireTout<{ referrer_org_id: string }>("recommandations", (de, a) => admin.from("employer_referrals").select("referrer_org_id").in("referrer_org_id", lot).order("id").range(de, a));
    for (const r of refs) recommandations.set(r.referrer_org_id, (recommandations.get(r.referrer_org_id) ?? 0) + 1);
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
      trial_ends_at: o.trial_ends_at,
      subscription_status: o.subscription_status,
      apporteur: a ? (a.organisation ? `${a.nom} (${a.organisation})` : a.nom) : null,
      derniereConnexionAuth: connexions.get(o.id) ?? null,
      accordDetail: o.partage_usage_detail === true,
    };
  });
  const lignes = calculerLignes(essais, { tournees, arrets, usages, recommandations }, maintenant);
  return { lignes, synthese: synthetiser(lignes) };
}

export type ResultatDetailEssai =
  | { ok: false; raison: "introuvable" | "pas_un_essai" | "accord_absent" | "migration_manquante" }
  | { ok: true; nom: string; accordLe: string | null; tournees: LigneTournee[]; evenements: EvenementUsage[] };

/**
 * Détail d'un compte d'essai, UNIQUEMENT si partage_usage_detail est vrai
 * (vérifié ici, côté serveur, à chaque lecture). Tournées (compteurs et
 * horaires) et chronologie (type + horodatage) : jamais de nom, d'adresse,
 * de téléphone, de code colis, de note ni de position GPS.
 */
export async function chargerDetailEssai(admin: SupabaseClient, orgId: string): Promise<ResultatDetailEssai> {
  const { data, error } = await admin.from("organizations").select("name, offre, partage_usage_detail, partage_usage_detail_at").eq("id", orgId).maybeSingle();
  if (error) return { ok: false, raison: estSchemaManquant(error) ? "migration_manquante" : "introuvable" };
  const org = data as { name: string; offre: string | null; partage_usage_detail: boolean | null; partage_usage_detail_at: string | null } | null;
  if (!org) return { ok: false, raison: "introuvable" };
  if (org.offre !== OFFRE_GO_NAVIGATION) return { ok: false, raison: "pas_un_essai" };
  if (org.partage_usage_detail !== true) return { ok: false, raison: "accord_absent" };

  const { tournees, arrets } = await lireTourneesEtArrets(admin, [orgId]);
  const [evenementsArret, usages] = await Promise.all([
    admin.from("delivery_stop_events").select("event_type, created_at").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(300),
    admin.from("usage_events").select("feature, units, created_at").eq("organization_id", orgId).in("feature", [FEATURE_ETIQUETTE, FEATURE_OPTIMISATION]).order("created_at", { ascending: false }).limit(300),
  ]);
  if (evenementsArret.error && !estSchemaManquant(evenementsArret.error)) console.error("usage essais (événements)", evenementsArret.error.message);
  if (usages.error && !estSchemaManquant(usages.error)) console.error("usage essais (consommation)", usages.error.message);

  return {
    ok: true,
    nom: org.name,
    accordLe: org.partage_usage_detail_at,
    tournees: detaillerTournees(tournees, arrets),
    evenements: chronologie((evenementsArret.data ?? []) as { event_type: string; created_at: string }[], (usages.data ?? []) as { feature: string; units: number; created_at: string }[]),
  };
}

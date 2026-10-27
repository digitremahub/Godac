import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppUser } from "@/lib/auth/session";
import { journaliser } from "@/lib/audit/journal";
import { bornesMois, contextePaie } from "@/lib/paie/donnees";
import { genererBulletinMois } from "@/lib/paie/generation-serveur";
import { aUneAnomalieBloquante, anomaliesDuSalarie, comparerAvecMoisPrecedent, statutPreparation, variablesInitiales, type AnomaliePaie, type BilanLot, type BulletinLu, type LigneComparaison } from "@/lib/paie/lot";
import { addMonths } from "@/lib/planning/dates";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";

/** Temps laissé à la préparation en lot avant de rendre la main (la route accepte 300 s) : le reste se prépare à la relance. */
const BUDGET_MS = 200_000;

export interface SalarieLot {
  id: string;
  nom: string;
  poste: string | null;
}

export interface PaieDuMois {
  mois: string;
  lignes: LigneComparaison[];
  anomalies: AnomaliePaie[];
  salaries: SalarieLot[];
  /** Bulletins en attente de validation (identifiants), pour la validation de la direction. */
  enAttente: string[];
  compteurs: { aPreparer: number; prepares: number; valides: number };
}

type Ligne = BulletinLu & { id: string; user_id: string };

async function bulletinsDuMois(db: SupabaseClient, organizationId: string, mois: string): Promise<Ligne[]> {
  const { debut, fin } = bornesMois(mois);
  const { data, error } = await db
    .from("payslips")
    .select("id, user_id, net_amount, validation_status, variables, details")
    .eq("organization_id", organizationId)
    .eq("period_start", debut)
    .eq("period_end", fin);
  if (error) throw new Error(`bulletins du mois : ${error.message}`);
  return (data ?? []) as unknown as Ligne[];
}

/**
 * Situation de la paie du mois : statut de chaque salarié, comparaison au mois
 * précédent (net, heures, primes) et anomalies. Lectures sous la RLS de la
 * personne connectée (direction, comptable). Aucune écriture.
 */
export async function chargerPaieDuMois(db: SupabaseClient, organizationId: string, mois: string): Promise<PaieDuMois> {
  const [{ data: users, error: errUsers }, { data: profils }, { data: contrats }, { data: dossiers }, courants, precedents] = await Promise.all([
    db.from("users").select("id, full_name, role_title").eq("organization_id", organizationId).eq("active", true).order("full_name"),
    db.from("payroll_profiles").select("user_id, hourly_rate").eq("organization_id", organizationId),
    db.from("user_contracts").select("user_id"),
    db.from("employee_files").select("user_id, contract_type").eq("organization_id", organizationId),
    bulletinsDuMois(db, organizationId, mois),
    bulletinsDuMois(db, organizationId, addMonths(mois, -1)),
  ]);
  if (errUsers) throw new Error(`salariés : ${errUsers.message}`);
  const salaries = ((users ?? []) as { id: string; full_name: string; role_title: string | null }[]).map((u) => ({ id: u.id, nom: u.full_name, poste: u.role_title }));
  const taux = new Map(((profils ?? []) as { user_id: string; hourly_rate: number | null }[]).map((p) => [p.user_id, Number(p.hourly_rate ?? 0)]));
  const aContrat = new Set([
    ...((contrats ?? []) as { user_id: string }[]).map((c) => c.user_id),
    ...((dossiers ?? []) as { user_id: string; contract_type: string | null }[]).filter((d) => d.contract_type).map((d) => d.user_id),
  ]);
  const courantDe = new Map(courants.map((b) => [b.user_id, b]));
  const precedentDe = new Map(precedents.map((b) => [b.user_id, b]));

  const lignes: LigneComparaison[] = [];
  const anomalies: AnomaliePaie[] = [];
  for (const s of salaries) {
    const courant = courantDe.get(s.id) ?? null;
    const precedent = precedentDe.get(s.id) ?? null;
    lignes.push(comparerAvecMoisPrecedent({ userId: s.id, nom: s.nom, courant, precedent }));
    anomalies.push(...anomaliesDuSalarie({ userId: s.id, nom: s.nom, tauxHoraire: taux.get(s.id) ?? null, aContrat: aContrat.has(s.id), courant, precedent }));
  }
  const statuts = lignes.map((l) => l.statut);
  return {
    mois,
    lignes,
    anomalies,
    salaries,
    enAttente: courants.filter((b) => statutPreparation(b) === "prepare" && b.validation_status !== "refuse").map((b) => b.id),
    compteurs: { aPreparer: statuts.filter((x) => x === "a_preparer").length, prepares: statuts.filter((x) => x === "prepare").length, valides: statuts.filter((x) => x === "valide").length },
  };
}

/**
 * Prépare tous les bulletins du mois qui n'existent pas encore, à partir des
 * valeurs préremplies (pointage, planning, congés, primes reprises) : mêmes
 * calculs que l'éditeur, bulletins « en attente de validation » (la direction
 * valide ensuite, même quand c'est elle qui prépare). Un bulletin existant
 * (préparé, refusé ou validé) n'est jamais écrasé. Un salarié dont le profil de
 * paie est incomplet (taux horaire nul) est ignoré et listé.
 */
export async function preparerPaieDuMois(supabase: SupabaseClient, appUser: Pick<AppUser, "id" | "role" | "organization_id">, mois: string): Promise<BilanLot> {
  const situation = await chargerPaieDuMois(supabase, appUser.organization_id, mois);
  const bilan: BilanLot = { prepares: 0, ignores: [], erreurs: [], restants: 0 };
  const aPreparer = situation.lignes.filter((l) => l.statut === "a_preparer");
  const debut = Date.now();
  for (let i = 0; i < aPreparer.length; i++) {
    const l = aPreparer[i]!;
    if (Date.now() - debut > BUDGET_MS) {
      bilan.restants = aPreparer.length - i;
      break;
    }
    if (aUneAnomalieBloquante(situation.anomalies, l.userId)) {
      bilan.ignores.push({ userId: l.userId, nom: l.nom, raison: "Taux horaire nul ou profil de paie à compléter." });
      continue;
    }
    try {
      const ctx = await contextePaie(supabase, appUser.organization_id, l.userId, mois);
      if (!ctx.profilComplet) {
        bilan.ignores.push({ userId: l.userId, nom: l.nom, raison: "Profil de paie incomplet." });
        continue;
      }
      const r = await genererBulletinMois({ supabase, appUser, userId: l.userId, mois, variables: variablesInitiales(ctx.prefill, ctx.entreprise, mois), validerSiDirection: false, contexte: ctx, lot: true });
      if (r.ok) bilan.prepares++;
      else bilan.erreurs.push({ userId: l.userId, nom: l.nom, erreur: r.error });
    } catch (e) {
      if (!estSchemaManquant(e as { message?: string })) console.error("paie en lot", l.userId, e);
      bilan.erreurs.push({ userId: l.userId, nom: l.nom, erreur: e instanceof Error ? e.message : "Erreur inattendue" });
    }
  }
  await journaliser({
    organizationId: appUser.organization_id,
    userId: appUser.id,
    action: "paie_lot_prepare",
    targetTable: "payslips",
    details: { mois, prepares: bilan.prepares, ignores: bilan.ignores.length, erreurs: bilan.erreurs.length, restants: bilan.restants, par: appUser.role },
  });
  return bilan;
}

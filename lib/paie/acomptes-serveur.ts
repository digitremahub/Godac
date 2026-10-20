import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { plafondAcompte, statutAcompte, PLAFOND_POURCENTAGE_DEFAUT, type DemandeAcompte } from "@/lib/paie/acomptes";

export const CHAMPS_DEMANDE =
  "id, user_id, period, amount_requested, amount_granted, reason, status, decided_at, decision_comment, paid_at, payslip_id, original_period, created_at";

/**
 * Table absente (migration 20261024000002 pas encore appliquée) : 42P01
 * côté Postgres, PGRST205 côté cache de schéma. Les écrans l'indiquent au
 * lieu d'échouer.
 */
export function tableAcomptesAbsente(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  return /relation .* does not exist|could not find the table/i.test(error.message ?? "");
}

export const MESSAGE_TABLE_ABSENTE = "Les demandes d'acompte ne sont pas encore activées pour votre entreprise (mise à jour de la base en attente).";

export function versDemande(row: Record<string, unknown>): DemandeAcompte {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    period: String(row.period),
    amount_requested: Number(row.amount_requested ?? 0),
    amount_granted: row.amount_granted === null || row.amount_granted === undefined ? null : Number(row.amount_granted),
    reason: (row.reason as string | null) ?? null,
    status: statutAcompte(row.status),
    decided_at: (row.decided_at as string | null) ?? null,
    decision_comment: (row.decision_comment as string | null) ?? null,
    paid_at: (row.paid_at as string | null) ?? null,
    payslip_id: (row.payslip_id as string | null) ?? null,
    original_period: (row.original_period as string | null) ?? null,
    created_at: String(row.created_at),
  };
}

/** Réglage du plafond (payroll_settings), avec repli tant que les colonnes n'existent pas. */
export async function reglagePlafond(supabase: SupabaseClient, organizationId: string): Promise<{ pourcentage: number; montantFixe: number | null; disponible: boolean }> {
  const { data, error } = await supabase
    .from("payroll_settings")
    .select("advance_cap_percent, advance_cap_amount")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) return { pourcentage: PLAFOND_POURCENTAGE_DEFAUT, montantFixe: null, disponible: false };
  return {
    pourcentage: data?.advance_cap_percent === null || data?.advance_cap_percent === undefined ? PLAFOND_POURCENTAGE_DEFAUT : Number(data.advance_cap_percent),
    montantFixe: data?.advance_cap_amount === null || data?.advance_cap_amount === undefined ? null : Number(data.advance_cap_amount),
    disponible: true,
  };
}

/**
 * Plafond indicatif d'un salarié. Le salarié ne lit pas les réglages de
 * paie (RLS direction / comptable) : ils sont relus par le client serveur,
 * limités à son organisation, et seul le plafond calculé lui est montré.
 * Le net habituel vient de son dernier bulletin validé (qu'il peut lire).
 */
export async function plafondDuSalarie(supabase: SupabaseClient, organizationId: string, userId: string) {
  let lecteur: SupabaseClient = supabase;
  try {
    lecteur = createAdminSupabaseClient() as unknown as SupabaseClient;
  } catch {
    // Pas de clé service : lecture sous RLS (direction / comptable seulement).
  }
  const [reglage, { data: dernier }] = await Promise.all([
    reglagePlafond(lecteur, organizationId),
    supabase
      .from("payslips")
      .select("net_amount, details")
      .eq("user_id", userId)
      .eq("validation_status", "valide")
      .order("period_start", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const details = (dernier?.details ?? null) as { netAvantRetenues?: number } | null;
  const netHabituel = dernier ? Number(details?.netAvantRetenues ?? dernier.net_amount ?? 0) || null : null;
  return {
    plafond: plafondAcompte({ netHabituel, pourcentage: reglage.pourcentage, montantFixe: reglage.montantFixe }),
    netHabituel,
    ...reglage,
  };
}

/**
 * Acomptes acceptés ou versés d'un salarié jusqu'au mois donné (inclus),
 * pour le bulletin. Liste vide si la table n'existe pas encore.
 */
export async function acomptesJusquAu(supabase: SupabaseClient, userId: string, debutMois: string): Promise<DemandeAcompte[]> {
  const { data, error } = await supabase
    .from("salary_advance_requests")
    .select(CHAMPS_DEMANDE)
    .eq("user_id", userId)
    .in("status", ["acceptee", "versee"])
    .lte("period", debutMois)
    .order("created_at");
  if (error) {
    if (!tableAcomptesAbsente(error)) console.warn("paie: lecture des acomptes impossible", error.message);
    return [];
  }
  return ((data ?? []) as Record<string, unknown>[]).map(versDemande);
}

/**
 * Rattache au bulletin les acomptes intégrés et détache ceux qui n'y sont
 * plus (régénération). Sans effet si la table n'existe pas encore.
 */
export async function rattacherAcomptes(supabase: SupabaseClient, payslipId: string, ids: string[]) {
  const detacher = supabase.from("salary_advance_requests").update({ payslip_id: null }).eq("payslip_id", payslipId);
  const { error: e1 } = ids.length ? await detacher.not("id", "in", `(${ids.join(",")})`) : await detacher;
  if (e1 && !tableAcomptesAbsente(e1)) console.warn("paie: détachement des acomptes impossible", e1.message);
  if (!ids.length) return;
  const { error: e2 } = await supabase.from("salary_advance_requests").update({ payslip_id: payslipId }).in("id", ids);
  if (e2 && !tableAcomptesAbsente(e2)) console.warn("paie: rattachement des acomptes impossible", e2.message);
}

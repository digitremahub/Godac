import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { soldeConges, type CongeDate, type Reprise, type SoldeConges } from "@/lib/paie/conges";

/**
 * Compteurs de congés payés de salariés d'une organisation, pour l'écran
 * des congés. Le profil de paie (solde de reprise) n'est lisible que par
 * la direction et le comptable : relu par le client serveur, limité à
 * l'organisation et aux salariés demandés ; seul le solde calculé est
 * montré. Sans clé serveur, lecture sous RLS (le salarié lit son profil).
 */
export async function soldesConges(supabase: SupabaseClient, organizationId: string, userIds: string[], aujourdhui: string): Promise<Map<string, SoldeConges>> {
  const resultat = new Map<string, SoldeConges>();
  const ids = Array.from(new Set(userIds)).slice(0, 300);
  if (!ids.length) return resultat;
  let lecteur: SupabaseClient = supabase;
  try {
    lecteur = createAdminSupabaseClient() as unknown as SupabaseClient;
  } catch {
    // Lecture sous RLS.
  }
  const depuis = `${Number(aujourdhui.slice(0, 4)) - 2}-06-01`;
  const [profils, { data: conges }] = await Promise.all([
    lecteur.from("payroll_profiles").select("user_id, leave_balance_n1, leave_balance_n, leave_balance_date").eq("organization_id", organizationId).in("user_id", ids),
    lecteur
      .from("leave_requests")
      .select("driver_id, start_date, end_date, status")
      .eq("organization_id", organizationId)
      .in("driver_id", ids)
      .in("status", ["approved", "pending"])
      .gte("end_date", depuis),
  ]);
  // Colonnes de reprise absentes (migration 20261024000003 pas encore passée) : sans reprise.
  const reprises = new Map<string, Reprise>();
  for (const p of (profils.error ? [] : profils.data ?? []) as Record<string, unknown>[]) {
    if (p.leave_balance_date && (p.leave_balance_n1 !== null || p.leave_balance_n !== null)) {
      reprises.set(String(p.user_id), { au: String(p.leave_balance_date), n1: Number(p.leave_balance_n1 ?? 0), n: Number(p.leave_balance_n ?? 0) });
    }
  }
  const valides = new Map<string, CongeDate[]>();
  const attente = new Map<string, CongeDate[]>();
  for (const c of (conges ?? []) as Record<string, unknown>[]) {
    const cible = c.status === "approved" ? valides : attente;
    const k = String(c.driver_id);
    cible.set(k, [...(cible.get(k) ?? []), { du: String(c.start_date), au: String(c.end_date) }]);
  }
  for (const id of ids) {
    resultat.set(id, soldeConges({ reprise: reprises.get(id) ?? null, aujourdhui, valides: valides.get(id) ?? [], enAttente: attente.get(id) ?? [] }));
  }
  return resultat;
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { alerteAffichable } from "@/lib/alerts/destinataires";
import { compterNonLues, filtreDestinataire, marquerLues, trierNonLuesDabord } from "@/lib/alerts/lecture";

export const COLONNES_ALERTE = "id, type, severity, message, status, notified_at, created_at, related_table, related_id, recipient_user_id, service_id";

export interface AlerteAffichee {
  id: string;
  type: string;
  severity: "info" | "warning" | "critical";
  message: string;
  status: "open" | "acknowledged" | "resolved";
  notified_at: string | null;
  created_at: string;
  related_table: string | null;
  related_id: string | null;
  recipient_user_id: string | null;
  service_id?: string | null;
  lu: boolean;
}

/** Identifiants lus par cette personne parmi `ids`. */
async function idsLus(supabase: SupabaseClient, userId: string, ids: readonly string[]): Promise<string[]> {
  // Par paquets de 100 : l'adresse de la requête reste courte.
  const paquets: string[][] = [];
  for (let i = 0; i < ids.length; i += 100) paquets.push(ids.slice(i, i + 100));
  const reponses = await Promise.all(paquets.map((p) => supabase.from("alert_reads").select("alert_id").eq("user_id", userId).in("alert_id", p)));
  return reponses.flatMap((r) => ((r.data ?? []) as { alert_id: string }[]).map((l) => l.alert_id));
}

/**
 * Alertes de la personne connectée (diffusées ou personnelles, sous la
 * RLS), avec l'indicateur « lu », non lues en premier.
 */
export async function chargerAlertes(
  supabase: SupabaseClient,
  userId: string,
  { ouvertes = false, limite = 5, role }: { ouvertes?: boolean; limite?: number; role?: string } = {},
): Promise<AlerteAffichee[]> {
  let q = supabase.from("alerts").select(COLONNES_ALERTE).or(filtreDestinataire(userId));
  if (ouvertes) q = q.eq("status", "open");
  const { data } = await q.order("created_at", { ascending: false }).limit(limite);
  // Filet : les alertes de tournée (nom du chauffeur) ne vont ni au comptable ni à un manager sans service (en plus de la RLS).
  const alertes = ((data ?? []) as Omit<AlerteAffichee, "lu">[]).filter((a) => !role || a.recipient_user_id || alerteAffichable(role, a));
  const lues = await idsLus(supabase, userId, alertes.map((a) => a.id));
  return trierNonLuesDabord(marquerLues(alertes, lues));
}

/** Notifications non lues de la personne (même fenêtre que la cloche : 30 jours). */
export async function compterNotificationsNonLues(supabase: SupabaseClient, userId: string, jours = 30): Promise<number> {
  const depuis = new Date(Date.now() - jours * 86400000).toISOString();
  const { data } = await supabase
    .from("alerts")
    .select("id")
    .or(filtreDestinataire(userId))
    .gte("created_at", depuis)
    .order("created_at", { ascending: false })
    .limit(500);
  const ids = ((data ?? []) as { id: string }[]).map((a) => a.id);
  return compterNonLues(ids, await idsLus(supabase, userId, ids));
}

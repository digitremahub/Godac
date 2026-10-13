import "server-only";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

/** Retention periods announced in app/confidentialite — keep both in sync. */
export const RETENTION_DAYS = {
  /** Anonymised assistant questions awaiting FAQ drafting. */
  questionLog: 90,
  /** GPS point recorded at clock-in/out (the clock times themselves are kept). */
  clockGps: 365,
  /** Assistant conversations, counted from their last message — same as the pg_cron cleanup_old_assistant_conversations job. */
  assistantConversations: 90,
  /** Tournées colis (adresses, noms, téléphones des destinataires, photos de livraison). */
  parcelRuns: 30,
} as const;

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

export async function purgeExpiredData() {
  const admin = createAdminSupabaseClient();
  const results: Record<string, string | number> = {};

  const log = await admin.from("assistant_question_log").delete({ count: "exact" }).lt("created_at", daysAgo(RETENTION_DAYS.questionLog));
  results.questionLog = log.error ? log.error.message : (log.count ?? 0);

  const gpsCutoff = daysAgo(RETENTION_DAYS.clockGps);
  const gpsIn = await admin
    .from("time_clock_entries")
    .update({ clock_in_lat: null, clock_in_lng: null }, { count: "exact" })
    .lt("clocked_in_at", gpsCutoff)
    .not("clock_in_lat", "is", null);
  results.clockGpsIn = gpsIn.error ? gpsIn.error.message : (gpsIn.count ?? 0);
  const gpsOut = await admin
    .from("time_clock_entries")
    .update({ clock_out_lat: null, clock_out_lng: null }, { count: "exact" })
    .lt("clocked_in_at", gpsCutoff)
    .not("clock_out_lat", "is", null);
  results.clockGpsOut = gpsOut.error ? gpsOut.error.message : (gpsOut.count ?? 0);

  const convs = await admin
    .from("assistant_conversations")
    .delete({ count: "exact" })
    .lt("updated_at", daysAgo(RETENTION_DAYS.assistantConversations));
  results.assistantConversations = convs.error ? convs.error.message : (convs.count ?? 0);

  // Photos de livraison des tournées purgées : effacées du stockage d'abord.
  const limite = daysAgo(RETENTION_DAYS.parcelRuns).slice(0, 10);
  const { data: photos } = await admin
    .from("delivery_stops")
    .select("proof_photo_path, delivery_runs!inner(run_date)")
    .lt("delivery_runs.run_date", limite)
    .not("proof_photo_path", "is", null);
  const chemins = (photos ?? []).map((p) => p.proof_photo_path as string);
  for (let i = 0; i < chemins.length; i += 100) await admin.storage.from("delivery-proofs").remove(chemins.slice(i, i + 100));
  results.deliveryPhotos = chemins.length;

  const runs = await admin
    .from("delivery_runs")
    .delete({ count: "exact" })
    .lt("run_date", limite);
  results.parcelRuns = runs.error ? runs.error.message : (runs.count ?? 0);

  return results;
}

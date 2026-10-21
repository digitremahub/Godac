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
  /** Tournées colis : adresses, initiales des destinataires et photos de livraison, gardées pour les contestations. */
  parcelRuns: 365,
  /** Tracé GPS réel des tournées colis (fil d'Ariane, analyse des trajets) : 1 an, recommandation CNIL. */
  parcelTrack: 365,
  /** Au-delà : nom complet réduit aux initiales, téléphone et consignes effacés. */
  parcelRecipients: 30,
  /** Journal d'audit des actions sensibles. */
  auditLog: 3 * 365,
  /** Journal anti-abus du lien prestataire (IP hachées). */
  providerAccessLog: 30,
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

  const audit = await admin.from("audit_log").delete({ count: "exact" }).lt("created_at", daysAgo(RETENTION_DAYS.auditLog));
  results.auditLog = audit.error ? audit.error.message : (audit.count ?? 0);

  const convs = await admin
    .from("assistant_conversations")
    .delete({ count: "exact" })
    .lt("updated_at", daysAgo(RETENTION_DAYS.assistantConversations));
  results.assistantConversations = convs.error ? convs.error.message : (convs.count ?? 0);

  // Destinataires des tournées de plus de 30 jours : initiales seulement,
  // téléphone et consignes effacés (adresses et photos gardées 12 mois pour les contestations).
  const limiteDestinataires = daysAgo(RETENTION_DAYS.parcelRecipients).slice(0, 10);
  const { data: aAnonymiser } = await admin
    .from("delivery_stops")
    .select("id, recipient, phone, notes, delivery_runs!inner(run_date)")
    .lt("delivery_runs.run_date", limiteDestinataires)
    .or("phone.not.is.null,notes.not.is.null,recipient.not.is.null")
    .limit(5000);
  let anonymises = 0;
  for (const st of (aAnonymiser ?? []) as { id: string; recipient: string | null; phone: string | null; notes: string | null }[]) {
    const initiales = initialesDestinataire(st.recipient);
    if (st.phone === null && st.notes === null && st.recipient === initiales) continue;
    const { error } = await admin.from("delivery_stops").update({ recipient: initiales, phone: null, notes: null }).eq("id", st.id);
    if (!error) anonymises++;
  }
  results.parcelRecipients = anonymises;

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

  // Tracé GPS des tournées : points de plus d'un an (les tournées supprimées emportent les leurs en cascade).
  const trace = await admin.from("delivery_run_track_points").delete({ count: "exact" }).lt("recorded_at", daysAgo(RETENTION_DAYS.parcelTrack));
  results.parcelTrack = trace.error ? trace.error.message : (trace.count ?? 0);

  const runs = await admin
    .from("delivery_runs")
    .delete({ count: "exact" })
    .lt("run_date", limite);
  results.parcelRuns = runs.error ? runs.error.message : (runs.count ?? 0);

  const access = await admin.from("rental_provider_access_log").delete({ count: "exact" }).lt("created_at", daysAgo(RETENTION_DAYS.providerAccessLog));
  results.providerAccessLog = access.error ? access.error.message : (access.count ?? 0);

  return results;
}

/** « Jean-Marc Dupont » → « J.-M. D. » ; déjà réduit ou vide : inchangé. */
export function initialesDestinataire(nom: string | null): string | null {
  if (!nom || !nom.trim()) return null;
  if (/^([A-ZÀ-Þ]\.(-[A-ZÀ-Þ]\.)?\s?)+$/.test(nom.trim())) return nom.trim();
  return nom
    .trim()
    .split(/\s+/)
    .map((mot) =>
      mot
        .split("-")
        .filter(Boolean)
        .map((p) => `${p[0]!.toLocaleUpperCase("fr-FR")}.`)
        .join("-"),
    )
    .join(" ");
}

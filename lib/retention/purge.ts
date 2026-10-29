import "server-only";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { cheminsPhotos, enLots } from "@/lib/retention/photos";
import { GPS_POINTAGE_JOURS, limiteGpsPointage } from "@/lib/retention/gps-pointage";
import { COLONNES_CLIENT_EFFACEES, RETENTION_FICHES_CLIENT_JOURS, limiteFichesClient } from "@/lib/retention/fiches-client";
import { GO_LIEUX_RECENTS_JOURS, limiteLieuxRecents } from "@/lib/retention/lieux-go";
import { RETENTION_AMENDES_JOURS, STATUTS_AMENDE_CLOTUREE, cheminsAmendes, limiteClotureAmendes } from "@/lib/retention/amendes";

/** Retention periods announced in app/confidentialite — keep both in sync. */
export const RETENTION_DAYS = {
  /** Anonymised assistant questions awaiting FAQ drafting. */
  questionLog: 90,
  /** Heures de pointage : 5 ans maximum, comme annoncé dans app/confidentialite (justification du temps de travail et de la paie). */
  clockEntries: 5 * 365,
  /** Position GPS de pointage : 2 mois (preuve du temps de travail en cas de litige), puis coordonnées effacées ; heures et statut conservés. */
  clockGps: GPS_POINTAGE_JOURS,
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
  /** Fiches client de l'annuaire (téléphone, contact, consignes, statistiques de passage) : 12 mois sans mise à jour. */
  clientFiches: RETENTION_FICHES_CLIENT_JOURS,
  /** Amendes : un an après leur clôture (réglée ou classée), comme annoncé ; en cours, jamais. */
  fines: RETENTION_AMENDES_JOURS,
  /** Destinations récentes de GO (« Aller à… ») : 90 jours après le dernier usage ; les favoris restent jusqu'à suppression par l'utilisateur. */
  goLieuxRecents: GO_LIEUX_RECENTS_JOURS,
} as const;

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

export async function purgeExpiredData() {
  const admin = createAdminSupabaseClient();
  const results: Record<string, string | number> = {};

  const log = await admin.from("assistant_question_log").delete({ count: "exact" }).lt("created_at", daysAgo(RETENTION_DAYS.questionLog));
  results.questionLog = log.error ? log.error.message : (log.count ?? 0);

  // Passé 2 mois : coordonnées effacées, heures de pointage, source et statut conservés.
  const gpsCutoff = limiteGpsPointage();
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

  // Pointages de plus de 5 ans (durée annoncée) ; les heures de paie des bulletins validés sont figées dans les bulletins.
  const pointages = await admin.from("time_clock_entries").delete({ count: "exact" }).lt("clocked_in_at", daysAgo(RETENTION_DAYS.clockEntries));
  results.clockEntries = pointages.error ? pointages.error.message : (pointages.count ?? 0);

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

  // Tracé GPS des tournées : points de plus d'un an (les tournées supprimées emportent les leurs en cascade).
  const trace = await admin.from("delivery_run_track_points").delete({ count: "exact" }).lt("recorded_at", daysAgo(RETENTION_DAYS.parcelTrack));
  results.parcelTrack = trace.error ? trace.error.message : (trace.count ?? 0);

  // Tournées expirées, lot par lot jusqu'à épuisement : les photos de preuve
  // (les trois photos d'un arrêt) sont effacées du stockage AVANT les lignes ;
  // si l'effacement échoue, les tournées du lot sont conservées pour un
  // prochain passage au lieu de laisser des photos orphelines.
  const limite = daysAgo(RETENTION_DAYS.parcelRuns).slice(0, 10);
  let photosEffacees = 0;
  let tourneesSupprimees = 0;
  let erreurTournees: string | null = null;
  for (;;) {
    const { data: lot, error: erreurLot } = await admin.from("delivery_runs").select("id").lt("run_date", limite).order("run_date").limit(100);
    if (erreurLot) { erreurTournees = erreurLot.message; break; }
    const ids = (lot ?? []).map((r) => r.id as string);
    if (ids.length === 0) break;

    const chemins = await photosDesTournees(admin, ids);
    if (typeof chemins === "string") { erreurTournees = chemins; break; }
    let echecStockage: string | null = null;
    for (const morceau of enLots(chemins)) {
      const { error } = await admin.storage.from("delivery-proofs").remove(morceau);
      if (error) { echecStockage = error.message; break; }
    }
    if (echecStockage) { erreurTournees = `Photos non effacées : ${echecStockage}`; break; }
    photosEffacees += chemins.length;

    const suppression = await admin.from("delivery_runs").delete({ count: "exact" }).in("id", ids);
    if (suppression.error) { erreurTournees = suppression.error.message; break; }
    if (!suppression.count) break;
    tourneesSupprimees += suppression.count;
  }
  results.deliveryPhotos = photosEffacees;
  results.parcelRuns = erreurTournees ?? tourneesSupprimees;

  // Amendes clôturées depuis plus d'un an : pièces effacées d'abord, lignes ensuite.
  const amendes = await purgerAmendes(admin);
  results.fineFiles = amendes.fichiers;
  results.fines = amendes.erreur ?? amendes.amendes;

  // Fiches client de l'annuaire et sens de tournée sans mise à jour depuis 12 mois (migration 20261113000001 ;
  // tables absentes = rien à purger).
  const fiches = await purgerFichesClient(admin);
  results.clientFichesSupprimees = fiches.erreur ?? fiches.supprimees;
  results.clientFichesAnonymisees = fiches.erreur ?? fiches.anonymisees;
  results.tourneeSens = fiches.erreurSens ?? fiches.sens;

  // Destinations récentes de GO (« Aller à… ») de plus de 90 jours ; table absente = rien à purger.
  const lieux = await purgerLieuxRecents(admin);
  results.goLieuxRecents = lieux.erreur ?? lieux.supprimes;

  const access = await admin.from("rental_provider_access_log").delete({ count: "exact" }).lt("created_at", daysAgo(RETENTION_DAYS.providerAccessLog));
  results.providerAccessLog = access.error ? access.error.message : (access.count ?? 0);

  return results;
}

type Admin = ReturnType<typeof createAdminSupabaseClient>;

/**
 * Purge des fiches client périmées (voir lib/retention/fiches-client.ts) : suppression des
 * fiches sans horaires, anonymisation de celles qui en ont (updated_at inchangé, donc
 * le passage suivant ne retrouve rien à faire), suppression du sens de tournée périmé.
 */
export async function purgerFichesClient(admin: Admin, maintenant: Date = new Date()): Promise<{ supprimees: number; anonymisees: number; sens: number; erreur: string | null; erreurSens: string | null }> {
  const limite = limiteFichesClient(maintenant);
  const manquante = (e: { code?: string | null; message?: string | null }) => e.code === "42P01" || e.code === "42703" || e.code === "PGRST205" || e.code === "PGRST204" || /does not exist|could not find/i.test(e.message ?? "");
  let supprimees = 0;
  let anonymisees = 0;
  let erreur: string | null = null;
  // Fiches sans horaires : supprimées.
  const sansHoraires = await admin.from("delivery_address_hours").delete({ count: "exact" }).lt("updated_at", limite).filter("weekly_schedule", "eq", "{}");
  if (sansHoraires.error) erreur = manquante(sansHoraires.error) ? null : sansHoraires.error.message;
  else supprimees = sansHoraires.count ?? 0;
  // Fiches avec horaires : coordonnées et statistiques effacées, horaires conservés. Seules celles qui
  // contiennent encore une donnée client sont touchées (idempotent).
  if (!erreur) {
    const anon = await admin
      .from("delivery_address_hours")
      .update(COLONNES_CLIENT_EFFACEES, { count: "exact" })
      .lt("updated_at", limite)
      .or("phone.not.is.null,recipient.not.is.null,access_notes.not.is.null,delivered_count.gt.0,failed_count.gt.0,service_samples.gt.0");
    if (anon.error) erreur = manquante(anon.error) ? null : anon.error.message;
    else anonymisees = anon.count ?? 0;
  }
  const sens = await admin.from("tournee_sens").delete({ count: "exact" }).lt("updated_at", limite);
  const erreurSens = sens.error ? (manquante(sens.error) ? null : sens.error.message) : null;
  return { supprimees, anonymisees, sens: sens.error ? 0 : (sens.count ?? 0), erreur, erreurSens };
}

/** Supprime les récents de GO plus vieux que 90 jours (jamais les favoris). Table absente (migration pas appliquée) : sans erreur. */
export async function purgerLieuxRecents(admin: Admin, maintenant: Date = new Date()): Promise<{ supprimes: number; erreur: string | null }> {
  const r = await admin.from("go_lieux").delete({ count: "exact" }).eq("genre", "recent").lt("dernier_usage", limiteLieuxRecents(maintenant));
  if (r.error) {
    const manquante = r.error.code === "42P01" || r.error.code === "PGRST205" || /does not exist|could not find/i.test(r.error.message ?? "");
    return { supprimes: 0, erreur: manquante ? null : r.error.message };
  }
  return { supprimes: r.count ?? 0, erreur: null };
}

/**
 * Purge des amendes réglées ou classées depuis plus d'un an, lot par lot
 * jusqu'à épuisement (100 par lot). Pour chaque lot, les pièces (avis, pièces
 * jointes, photos des échanges) sont effacées du stockage AVANT les lignes ; si
 * l'effacement échoue, les amendes du lot sont conservées pour un prochain
 * passage plutôt que de laisser des fichiers orphelins. Colonne closed_at
 * absente (migration 20261108000003 pas appliquée) : rien n'est purgé.
 */
export async function purgerAmendes(admin: Admin, maintenant: Date = new Date()): Promise<{ fichiers: number; amendes: number; erreur: string | null }> {
  const limite = limiteClotureAmendes(maintenant);
  let fichiers = 0;
  let amendes = 0;
  for (;;) {
    const { data: lot, error } = await admin
      .from("fines")
      .select("id, photo_path, document_paths")
      .in("status", [...STATUTS_AMENDE_CLOTUREE])
      .not("closed_at", "is", null)
      .lt("closed_at", limite)
      .order("closed_at")
      .limit(100);
    if (error) return { fichiers, amendes, erreur: error.message };
    const ids = (lot ?? []).map((a) => a.id as string);
    if (ids.length === 0) return { fichiers, amendes, erreur: null };

    const { data: echanges, error: erreurEchanges } = await admin.from("case_comments").select("photo_paths").in("fine_id", ids);
    if (erreurEchanges) return { fichiers, amendes, erreur: erreurEchanges.message };
    const chemins = cheminsAmendes((lot ?? []) as { photo_path?: string | null; document_paths?: string[] | null }[], (echanges ?? []) as { photo_paths?: string[] | null }[]);
    for (const morceau of enLots(chemins)) {
      const { error: e } = await admin.storage.from("fine-photos").remove(morceau);
      if (e) return { fichiers, amendes, erreur: `Pièces non effacées : ${e.message}` };
    }
    fichiers += chemins.length;

    const suppression = await admin.from("fines").delete({ count: "exact" }).in("id", ids);
    if (suppression.error) return { fichiers, amendes, erreur: suppression.error.message };
    if (!suppression.count) return { fichiers, amendes, erreur: null };
    amendes += suppression.count;
  }
}

/** Chemins de toutes les photos de preuve des arrêts de ces tournées (pagination), ou le message d'erreur. */
async function photosDesTournees(admin: ReturnType<typeof createAdminSupabaseClient>, runIds: string[]): Promise<string[] | string> {
  const PAGE = 1000;
  const chemins = new Set<string>();
  for (let debut = 0; ; debut += PAGE) {
    const { data, error } = await admin
      .from("delivery_stops")
      .select("proof_photo_path, proof_photo_paths")
      .in("run_id", runIds)
      .order("id")
      .range(debut, debut + PAGE - 1);
    if (error) return error.message;
    for (const c of cheminsPhotos(data ?? [])) chemins.add(c);
    if ((data ?? []).length < PAGE) return [...chemins];
  }
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

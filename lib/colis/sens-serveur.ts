import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LIST_FIELDS } from "@/lib/colis/serveur";
import { estListeReportee } from "@/lib/colis/villages";
import {
  HISTORIQUE_MAX,
  ajouterObservation,
  apprendreSens,
  cleSecteur,
  lireHistorique,
  lireMode,
  orientationAutourDepot,
  ordreObserve,
  portee,
  type HabitudeSens,
  type ModeSens,
  type ObservationSens,
  type Orientation,
} from "@/lib/colis/sens-tournee";
import { dateParis } from "@/lib/colis/heure-paris";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";

/** Tournée telle que l'habitude la voit : sa portée (modèle de tournée, sinon chauffeur + service). */
export interface RunSens {
  id: string;
  run_date: string;
  driver_id: string | null;
  service_id: string | null;
  route_id: string | null;
  start_lat: number | string | null;
  start_lng: number | string | null;
}

export async function runPourSens(supabase: SupabaseClient, organizationId: string, runId: string): Promise<RunSens | null> {
  const champs = "id, run_date, driver_id, service_id, start_lat, start_lng";
  let r = await supabase.from("delivery_runs").select(`${champs}, route_id`).eq("id", runId).eq("organization_id", organizationId).maybeSingle();
  if (r.error) r = await supabase.from("delivery_runs").select(champs).eq("id", runId).eq("organization_id", organizationId).maybeSingle();
  const d = r.data as (Omit<RunSens, "route_id"> & { route_id?: string | null }) | null;
  return d ? { ...d, route_id: d.route_id ?? null } : null;
}

export interface PreferenceSens {
  mode: ModeSens;
  reset_at: string | null;
  historique: ObservationSens[];
  /** false : table absente (migration non appliquée), rien n'est mémorisé. */
  persiste: boolean;
}

export async function lirePreferenceSens(supabase: SupabaseClient, organizationId: string, scope: string): Promise<PreferenceSens> {
  const { data, error } = await supabase.from("tournee_sens").select("mode, reset_at, historique").eq("organization_id", organizationId).eq("scope_key", scope).maybeSingle();
  if (error) return { mode: "habituel", reset_at: null, historique: [], persiste: !estSchemaManquant(error) };
  const d = data as { mode?: unknown; reset_at?: string | null; historique?: unknown } | null;
  return { mode: lireMode(d?.mode), reset_at: d?.reset_at ?? null, historique: lireHistorique(d?.historique), persiste: true };
}

/** Écrit (crée ou met à jour) la préférence ; false si la table n'existe pas encore. Les champs absents ne changent pas. */
export async function ecrirePreferenceSens(
  supabase: SupabaseClient,
  organizationId: string,
  userId: string,
  scope: string,
  courant: PreferenceSens,
  changement: { mode?: ModeSens; reset_at?: string | null; historique?: ObservationSens[] },
): Promise<boolean> {
  const { error } = await supabase.from("tournee_sens").upsert(
    {
      organization_id: organizationId,
      scope_key: scope,
      mode: changement.mode ?? courant.mode,
      reset_at: changement.reset_at !== undefined ? changement.reset_at : courant.reset_at,
      historique: changement.historique ?? courant.historique,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,scope_key" },
  );
  if (!error) return true;
  if (estSchemaManquant(error)) return false;
  throw new Error(error.message);
}

/** Ordre effectif des secteurs de tournées clôturées, lu en base (listes + arrêts clôturés). */
async function observations(supabase: SupabaseClient, runs: { id: string; run_date: string }[]): Promise<ObservationSens[]> {
  if (!runs.length) return [];
  const ids = runs.map((r) => r.id);
  const [{ data: listes }, { data: arrets }] = await Promise.all([
    supabase.from("delivery_lists").select(`${LIST_FIELDS}, run_id`).in("run_id", ids),
    supabase.from("delivery_stops").select("run_id, list_id, status, done_at").in("run_id", ids).neq("status", "pending"),
  ]);
  const out: ObservationSens[] = [];
  for (const run of runs) {
    const ordre = ordreObserve(
      ((arrets ?? []) as { run_id: string; list_id: string | null; status: string; done_at: string | null }[]).filter((a) => a.run_id === run.id),
      ((listes ?? []) as { id: string; name: string; run_id: string }[]).filter((l) => l.run_id === run.id),
      estListeReportee,
    );
    if (ordre.length >= 2) out.push({ run_id: run.id, date: run.run_date, ordre });
  }
  return out;
}

/**
 * Tournée qui vient d'être clôturée : on retient l'ordre dans lequel ses
 * secteurs ont été parcourus (idempotent : la même tournée remplace sa ligne).
 * Non bloquant : toute erreur est journalisée sans remonter.
 */
export async function enregistrerSensRun(supabase: SupabaseClient, organizationId: string, userId: string, runId: string): Promise<void> {
  try {
    const run = await runPourSens(supabase, organizationId, runId);
    const scope = run ? portee(run) : null;
    if (!run || !scope) return;
    const [obs] = await observations(supabase, [run]);
    if (!obs) return;
    const pref = await lirePreferenceSens(supabase, organizationId, scope);
    if (!pref.persiste) return;
    await ecrirePreferenceSens(supabase, organizationId, userId, scope, pref, { historique: ajouterObservation(pref.historique, obs) });
  } catch (e) {
    console.error("sens de tournée (non bloquant)", e instanceof Error ? e.message : e);
  }
}

/**
 * Tournées clôturées de la même portée que l'historique ne connaît pas encore
 * (clôturées avant la mise en service, ou hors ligne) : elles sont ajoutées tant
 * que les données existent (conservées 30 jours côté destinataires, 12 mois côté tournée).
 */
async function rattraper(supabase: SupabaseClient, organizationId: string, run: RunSens, pref: PreferenceSens): Promise<ObservationSens[]> {
  let q = supabase.from("delivery_runs").select("id, run_date").eq("organization_id", organizationId).eq("status", "done").neq("id", run.id).order("run_date", { ascending: false }).limit(HISTORIQUE_MAX);
  if (run.route_id) q = q.eq("route_id", run.route_id);
  else {
    if (!run.driver_id) return pref.historique;
    q = q.eq("driver_id", run.driver_id);
    q = run.service_id ? q.eq("service_id", run.service_id) : q.is("service_id", null);
  }
  const { data, error } = await q;
  if (error) return pref.historique;
  const connus = new Set(pref.historique.map((h) => h.run_id));
  const nouveaux = ((data ?? []) as { id: string; run_date: string }[]).filter((r) => !connus.has(r.id));
  let historique = pref.historique;
  for (const o of await observations(supabase, nouveaux)) historique = ajouterObservation(historique, o);
  return historique;
}

export interface SensDeLaTournee {
  scope: string | null;
  mode: ModeSens;
  habitude: HabitudeSens | null;
  persiste: boolean;
  reset_at: string | null;
}

/** Habitude applicable à la tournée (apprise des tournées clôturées de sa portée) et choix mémorisé. */
export async function sensDeLaTournee(supabase: SupabaseClient, organizationId: string, userId: string, run: RunSens): Promise<SensDeLaTournee> {
  const scope = portee(run);
  if (!scope) return { scope: null, mode: "habituel", habitude: null, persiste: false, reset_at: null };
  let pref = await lirePreferenceSens(supabase, organizationId, scope);
  const oublie = pref.reset_at ? dateParis(new Date(pref.reset_at)) : null;
  let habitude = apprendreSens(pref.historique, oublie);
  if (!habitude && pref.persiste) {
    // Pas encore d'habitude : on la reconstitue des tournées déjà clôturées de la même portée.
    const historique = await rattraper(supabase, organizationId, run, pref);
    if (historique.length !== pref.historique.length) {
      pref = { ...pref, historique };
      await ecrirePreferenceSens(supabase, organizationId, userId, scope, pref, { historique }).catch(() => false);
    }
    habitude = apprendreSens(historique, oublie);
  }
  return { scope, mode: pref.mode, habitude, persiste: pref.persiste, reset_at: pref.reset_at };
}

/** Rotation du sens habituel autour du dépôt, d'après les arrêts de la tournée courante (si au moins trois secteurs y sont localisés). */
export async function orientationDeLHabitude(supabase: SupabaseClient, runId: string, depot: { lat: number; lng: number } | null, habitude: HabitudeSens): Promise<Orientation | null> {
  if (!depot) return null;
  const [{ data: listes }, { data: arrets }] = await Promise.all([
    supabase.from("delivery_lists").select(LIST_FIELDS).eq("run_id", runId),
    supabase.from("delivery_stops").select("list_id, lat, lng").eq("run_id", runId),
  ]);
  const centre = new Map<string, { lat: number; lng: number }>();
  for (const l of (listes ?? []) as { id: string; name: string }[]) {
    const pts = ((arrets ?? []) as { list_id: string | null; lat: number | string | null; lng: number | string | null }[]).filter((a) => a.list_id === l.id && a.lat !== null && a.lng !== null);
    if (!pts.length) continue;
    centre.set(cleSecteur(l.name), { lat: pts.reduce((t, p) => t + Number(p.lat), 0) / pts.length, lng: pts.reduce((t, p) => t + Number(p.lng), 0) / pts.length });
  }
  const centres = habitude.ordre.map((s) => centre.get(s.cle)).filter((c): c is { lat: number; lng: number } => Boolean(c));
  return orientationAutourDepot(depot, centres);
}

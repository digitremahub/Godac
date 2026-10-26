import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { isModuleEnabled } from "@/lib/organization/modules";
import { buildDriverDepotsMap } from "@/lib/time-clock/driver-depots";
import { depotMatch, distanceDepotProcheM, loinDuDepot, MAX_ACCURACY_M } from "@/lib/time-clock/assisted";
import { decider, heureSortieDernierePresence, refusAnnulationSortie } from "@/lib/time-clock/sortie-depot";
import { etatTourneesChauffeur } from "@/lib/time-clock/tournees-chauffeur";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { journaliser } from "@/lib/audit/journal";

const positionSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative(),
});

const UNDO_WINDOW_MS = 15 * 60 * 1000;
/** Pas besoin de ré-écrire la présence au dépôt plus d'une fois toutes les 20 s. */
const PAS_MAJ_PRESENCE_MS = 20 * 1000;

type EntreeOuverte = { id: string; clocked_in_at: string; clock_in_source: string | null; last_depot_seen_at: string | null };

/**
 * Entrée ouverte du salarié, avec sa dernière présence au dépôt. Tolère
 * l'absence de la colonne (migration 20261103000005 non appliquée) : on
 * relit alors sans elle et la sortie automatique reste simplement inactive.
 */
async function lireEntreeOuverte(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, userId: string): Promise<{ entree: EntreeOuverte | null; colonnes: boolean; erreur?: string }> {
  const complet = await supabase.from("time_clock_entries").select("id, clocked_in_at, clock_in_source, last_depot_seen_at").eq("user_id", userId).is("clocked_out_at", null).maybeSingle();
  if (!complet.error) return { entree: (complet.data as EntreeOuverte | null) ?? null, colonnes: true };
  if (!estSchemaManquant(complet.error)) return { entree: null, colonnes: true, erreur: complet.error.message };
  const simple = await supabase.from("time_clock_entries").select("id, clocked_in_at, clock_in_source").eq("user_id", userId).is("clocked_out_at", null).maybeSingle();
  if (simple.error) return { entree: null, colonnes: false, erreur: simple.error.message };
  return { entree: simple.data ? { ...(simple.data as { id: string; clocked_in_at: string; clock_in_source: string | null }), last_depot_seen_at: null } : null, colonnes: false };
}

/**
 * Pointage assisté (organizations.auto_clock_enabled, activé par défaut).
 * Appelé à l'ouverture de l'app, puis toutes les 60 s tant que l'app est
 * ouverte, la tournée clôturée et la sortie non pointée
 * (components/time-clock/useSortieDepot.ts) — jamais en arrière-plan,
 * jamais de trace continue : la position reçue n'est comparée qu'au
 * rayon du dépôt et rien n'en est conservé, sauf l'horodatage de la
 * dernière présence au dépôt (last_depot_seen_at) et, à la sortie, les
 * coordonnées de sortie déjà prévues par le pointage.
 * - Pas pointé et à un dépôt du salarié → entrée (clock_in_source =
 *   'auto'), annulable 15 minutes via DELETE.
 * - Pointé et au dépôt → mémorise la présence (last_depot_seen_at).
 * - Pointé, position précise franchement hors dépôt (rayon + marge), plus
 *   de tournée en cours, une tournée clôturée, présence au dépôt vue il y
 *   a moins de 60 minutes (ou entrée automatique aussi récente) →
 *   sortie automatique À L'HEURE DE LA DERNIÈRE PRÉSENCE (jamais
 *   « maintenant »), annulable via DELETE.
 * - Mêmes conditions mais présence absente ou ancienne → aucune
 *   modification : « offer_out_left_depot », le salarié choisit l'heure.
 */
export async function POST(req: Request) {
  const g = await garderApi({ modules: ["time_clock"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const parsed = positionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Position invalide." }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const [timeClockEnabled, { data: organization }] = await Promise.all([
    isModuleEnabled(supabase, appUser.organization_id, "time_clock"),
    supabase.from("organizations").select("auto_clock_enabled").eq("id", appUser.organization_id).single(),
  ]);
  if (!timeClockEnabled || !organization?.auto_clock_enabled) {
    return NextResponse.json({ status: "disabled" });
  }

  const { depotsFor } = await buildDriverDepotsMap(supabase, appUser.organization_id);
  const point = { lat: parsed.data.latitude, lng: parsed.data.longitude };
  const depots = depotsFor(appUser.id);
  const match = depotMatch(point, parsed.data.accuracy, depots);

  const lecture = await lireEntreeOuverte(supabase, appUser.id);
  if (lecture.erreur) return NextResponse.json({ error: lecture.erreur }, { status: 500 });
  const open = lecture.entree;

  if (open) {
    const maintenant = new Date();
    const positionPrecise = parsed.data.accuracy <= MAX_ACCURACY_M;
    // Sans position précise on ne conclut rien : pas besoin de lire les tournées.
    const tournees = positionPrecise
      ? await etatTourneesChauffeur(supabase, { organizationId: appUser.organization_id, userId: appUser.id, clockedInAt: open.clocked_in_at })
      : { enCours: false, cloturee: false };

    const decision = decider({
      organisationActive: true,
      entreeOuverte: true,
      clockedInAt: open.clocked_in_at,
      positionPrecise,
      auDepot: Boolean(match),
      loinDuDepot: loinDuDepot(distanceDepotProcheM(point, depots)),
      entreeAuto: open.clock_in_source === "auto",
      tourneeEnCours: tournees.enCours,
      tourneeCloturee: tournees.cloturee,
      // Sans la colonne (migration absente) pas de sortie automatique : on ne propose que « maintenant ».
      lastDepotSeenAt: open.last_depot_seen_at,
      maintenant,
    });

    // « suivi » : y a-t-il une raison de continuer à lire la position ? Non tant qu'une tournée est en
    // cours ou qu'aucune n'a été clôturée (ex. un responsable sans tournée) — le client s'arrête alors.
    const suivi = !positionPrecise || (!tournees.enCours && tournees.cloturee);
    const base = { atDepot: Boolean(match), clockedInAt: open.clocked_in_at, suivi };

    if (decision.action === "maj_presence") {
      const derniere = open.last_depot_seen_at ? new Date(open.last_depot_seen_at).getTime() : 0;
      if (lecture.colonnes && maintenant.getTime() - derniere > PAS_MAJ_PRESENCE_MS) {
        // Entrée toujours ouverte : la politique « close own open entry » (RLS) l'autorise.
        const { error } = await supabase.from("time_clock_entries").update({ last_depot_seen_at: maintenant.toISOString() }).eq("id", open.id).is("clocked_out_at", null);
        if (error && !estSchemaManquant(error)) console.error("pointage : présence au dépôt", error.message);
      }
      return NextResponse.json({ status: "clocked_in", ...base });
    }

    if (decision.action === "sortie_auto") {
      // Heure antérieure à « maintenant » : le déclencheur de la table ne l'autorise pas à un salarié, d'où le service role.
      const admin = createAdminSupabaseClient();
      const { data: fermee, error } = await admin
        .from("time_clock_entries")
        .update({ clocked_out_at: decision.clockedOutAt, auto_clocked_out: true, clock_out_lat: point.lat, clock_out_lng: point.lng })
        .eq("id", open.id)
        .eq("user_id", appUser.id)
        .is("clocked_out_at", null)
        .select("id")
        .maybeSingle();
      if (error && estSchemaManquant(error)) return NextResponse.json({ status: "clocked_in", ...base });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      // Fermée entre-temps (bascule manuelle) : rien à annoncer.
      if (!fermee) return NextResponse.json({ status: "clocked_in", ...base });
      await journaliser({
        organizationId: appUser.organization_id,
        userId: appUser.id,
        action: "pointage_sortie_auto",
        targetTable: "time_clock_entries",
        targetId: open.id,
        details: { sortie: decision.clockedOutAt },
      });
      return NextResponse.json({ status: "auto_clocked_out", clockedOutAt: decision.clockedOutAt, entryId: open.id });
    }

    if (decision.action === "offre") {
      return NextResponse.json({ status: "offer_out_left_depot", lastSeenAt: decision.lastSeenAt });
    }

    return NextResponse.json({ status: "clocked_in", ...base });
  }
  if (!match) {
    return NextResponse.json({ status: "not_at_depot" });
  }

  // L'arrivée vaut première présence au dépôt (last_depot_seen_at) ; sans la colonne (migration absente) on réessaie sans elle.
  const nouvelle = { organization_id: appUser.organization_id, user_id: appUser.id, clock_in_lat: point.lat, clock_in_lng: point.lng, clock_in_source: "auto" };
  let { data: entry, error } = await supabase.from("time_clock_entries").insert({ ...nouvelle, last_depot_seen_at: new Date().toISOString() }).select("id, clocked_in_at").single();
  if (error && estSchemaManquant(error)) {
    ({ data: entry, error } = await supabase.from("time_clock_entries").insert(nouvelle).select("id, clocked_in_at").single());
  }
  // Pointage déjà ouvert entre-temps (index unique, audit M1).
  if (error?.code === "23505") return NextResponse.json({ status: "clocked_in", atDepot: true });
  if (error || !entry) return NextResponse.json({ error: error?.message ?? "Pointage impossible." }, { status: 500 });

  return NextResponse.json({ status: "auto_clocked_in", entryId: entry.id, clockedInAt: entry.clocked_in_at, distanceM: match.distanceM });
}

const sortieSchema = z.object({
  /** Seule valeur acceptée : l'heure vient de la base, jamais du client. */
  at: z.literal("last_seen"),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

/**
 * « Sortie à ma dernière présence au dépôt » (proposition
 * offer_out_left_depot). L'heure est last_depot_seen_at lu en base :
 * le client ne peut pas en fournir une autre. Choix explicite du
 * salarié (pas auto_clocked_out) : pas d'annulation, il peut demander
 * une correction à sa direction.
 */
export async function PUT(req: Request) {
  const g = await garderApi({ modules: ["time_clock"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const parsed = sortieSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Demande invalide." }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const lecture = await lireEntreeOuverte(supabase, appUser.id);
  if (lecture.erreur) return NextResponse.json({ error: lecture.erreur }, { status: 500 });
  const open = lecture.entree;
  if (!open) return NextResponse.json({ error: "Vous n'êtes pas pointé." }, { status: 409 });

  const heure = heureSortieDernierePresence({ lastDepotSeenAt: open.last_depot_seen_at, clockedInAt: open.clocked_in_at, maintenant: new Date() });
  if (!heure.ok) return NextResponse.json({ error: heure.error }, { status: 409 });

  const tournees = await etatTourneesChauffeur(supabase, { organizationId: appUser.organization_id, userId: appUser.id, clockedInAt: open.clocked_in_at });
  if (tournees.enCours) return NextResponse.json({ error: "Une tournée est en cours : terminez-la avant de pointer la sortie." }, { status: 409 });

  const admin = createAdminSupabaseClient();
  const { data: fermee, error } = await admin
    .from("time_clock_entries")
    .update({ clocked_out_at: heure.at, clock_out_lat: parsed.data.latitude ?? null, clock_out_lng: parsed.data.longitude ?? null })
    .eq("id", open.id)
    .eq("user_id", appUser.id)
    .is("clocked_out_at", null)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!fermee) return NextResponse.json({ error: "Vous n'êtes plus pointé." }, { status: 409 });

  await journaliser({
    organizationId: appUser.organization_id,
    userId: appUser.id,
    action: "pointage_sortie_derniere_presence",
    targetTable: "time_clock_entries",
    targetId: open.id,
    details: { sortie: heure.at },
  });
  return NextResponse.json({ status: "clocked_out", clockedOutAt: heure.at });
}

/**
 * « Annuler » sur la bannière.
 * - Entrée assistée : RLS n'a pas de politique de suppression sur
 *   time_clock_entries (un badge est un enregistrement, pas un
 *   brouillon) ; on passe donc par le service role, et uniquement pour
 *   l'entrée ouverte, assistée, de l'appelant, des 15 dernières minutes.
 * - Sortie automatique (auto_clocked_out) : ré-ouvre l'entrée
 *   (clocked_out_at = null) si c'est la dernière entrée du salarié et
 *   qu'elle date de moins de 2 h (refusAnnulationSortie) ; la mémoire de
 *   présence est effacée pour ne pas re-déclencher la sortie aussitôt.
 */
export async function DELETE(req: Request) {
  const g2 = await garderApi({ modules: ["time_clock"] });
  if (!g2.ok) return g2.reponse;
  const appUser = g2.appUser;
  const entryId = new URL(req.url).searchParams.get("id");
  if (!entryId || !/^[0-9a-f-]{36}$/i.test(entryId)) {
    return NextResponse.json({ error: "Pointage introuvable." }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  let colonnes = true;
  let lu: any = await admin
    .from("time_clock_entries")
    .select("id, user_id, organization_id, clock_in_source, clocked_out_at, clocked_in_at, auto_clocked_out")
    .eq("id", entryId)
    .maybeSingle();
  if (lu.error && estSchemaManquant(lu.error)) {
    colonnes = false;
    lu = await admin.from("time_clock_entries").select("id, user_id, organization_id, clock_in_source, clocked_out_at, clocked_in_at").eq("id", entryId).maybeSingle();
  }
  const entry = lu.data as {
    id: string;
    user_id: string;
    organization_id: string;
    clock_in_source: string;
    clocked_out_at: string | null;
    clocked_in_at: string;
    auto_clocked_out?: boolean | null;
  } | null;

  // Annulation d'une sortie pointée automatiquement.
  if (entry && entry.user_id === appUser.id && entry.organization_id === appUser.organization_id && entry.clocked_out_at !== null) {
    if (!colonnes) return NextResponse.json({ error: "Cette sortie ne peut pas être annulée." }, { status: 409 });
    const [{ data: derniere }, { data: ouvertes }] = await Promise.all([
      admin.from("time_clock_entries").select("id").eq("user_id", appUser.id).order("clocked_in_at", { ascending: false }).limit(1),
      admin.from("time_clock_entries").select("id").eq("user_id", appUser.id).is("clocked_out_at", null).limit(1),
    ]);
    const refus = refusAnnulationSortie(
      { id: entry.id, user_id: entry.user_id, auto_clocked_out: entry.auto_clocked_out ?? false, clocked_out_at: entry.clocked_out_at },
      appUser.id,
      derniere?.[0]?.id ?? null,
      (ouvertes?.length ?? 0) > 0,
      new Date(),
    );
    if (refus) return NextResponse.json({ error: refus }, { status: 409 });

    const { error } = await admin
      .from("time_clock_entries")
      .update({ clocked_out_at: null, auto_clocked_out: false, clock_out_lat: null, clock_out_lng: null, last_depot_seen_at: null })
      .eq("id", entry.id)
      .eq("user_id", appUser.id)
      .eq("auto_clocked_out", true);
    if (error?.code === "23505") return NextResponse.json({ error: "Vous êtes déjà pointé : cette sortie ne peut plus être annulée." }, { status: 409 });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await journaliser({
      organizationId: appUser.organization_id,
      userId: appUser.id,
      action: "pointage_sortie_auto_annulee",
      targetTable: "time_clock_entries",
      targetId: entry.id,
      details: { sortieAnnulee: entry.clocked_out_at },
    });
    return NextResponse.json({ status: "sortie_annulee" });
  }

  if (
    !entry ||
    entry.user_id !== appUser.id ||
    entry.organization_id !== appUser.organization_id ||
    entry.clock_in_source !== "auto" ||
    entry.clocked_out_at !== null ||
    Date.now() - new Date(entry.clocked_in_at).getTime() > UNDO_WINDOW_MS
  ) {
    return NextResponse.json({ error: "Ce pointage ne peut plus être annulé." }, { status: 409 });
  }

  const { error } = await admin.from("time_clock_entries").delete().eq("id", entry.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ status: "undone" });
}

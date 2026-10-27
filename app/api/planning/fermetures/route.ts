import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { journaliser } from "@/lib/audit/journal";
import { addDays, parisWallTimeToUtcISOString } from "@/lib/planning/dates";
import { peutFermerNonAffectee } from "@/lib/planning/ouverture";
import { decisionsFermeture, decisionsReouverture } from "@/lib/planning/fermeture-tournee";
import { cloreAlertesDesTournees } from "@/lib/planning/fermeture-serveur";
import type { AffectationPlanning } from "@/lib/planning/semaine";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { noterModificationPlanning } from "@/lib/planning/suivi-auto-serveur";

const bodySchema = z.object({
  /** false : fermer ; true : rouvrir. */
  ouverte: z.boolean(),
  service_id: z.string().uuid(),
  tour_number: z.string().trim().min(1).max(60),
  /** Jours de Paris : un jour, la semaine affichée, une plage. */
  dates: z.array(z.string().date()).min(1).max(62),
  /** Heure de départ de la tournée (« HH:MM », Paris) donnée à la fermeture créée. */
  heure: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
});

const MIGRATION_MANQUANTE = "Fermer une tournée demande une mise à jour de la base (migration pas encore appliquée).";

/**
 * Fermer ou rouvrir une tournée NON AFFECTÉE (sans chauffeur) pour un ou
 * plusieurs jours : la tournée ne roule pas ce jour-là (férié, pas de
 * volume, tournée supprimée). Elle n'est plus « à pourvoir » (couverture,
 * « À traiter »), ne donne plus d'alerte (les alertes ouvertes se closent) et
 * ne peut plus être affectée tant qu'elle est fermée.
 *
 * Modèle : une ligne planning_entries sans chauffeur avec tour_open = false
 * (lib/planning/fermeture-tournee.ts). Fermer : crée la ligne, ou ferme la
 * ligne « à remplacer » existante ; un jour où un chauffeur est placé est
 * refusé (retirer le chauffeur d'abord) sans bloquer les autres jours.
 * Rouvrir : supprime la ligne vide de la fermeture. Droits : direction,
 * exploitation, manager de son service (lib/planning/ouverture.ts ›
 * peutFermerNonAffectee). RLS : la lecture et l'écriture restent bornées au
 * service. Tracé au journal d'audit. Fermer une tournée AFFECTÉE reste
 * POST /api/planning/entries/[id]/ouverture.
 */
export async function POST(req: Request) {
  const g = await garderApi({ modules: ["planning"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const { ouverte, service_id, tour_number, heure } = parsed.data;
  const dates = [...new Set(parsed.data.dates)].sort();

  const supabase = await createServerSupabaseClient();
  const { data: liens } = await supabase.from("user_services").select("service_id").eq("user_id", appUser.id);
  const verdict = peutFermerNonAffectee({ role: appUser.role, serviceIds: ((liens ?? []) as { service_id: string }[]).map((l) => l.service_id), serviceId: service_id });
  if (!verdict.ok) return NextResponse.json({ error: verdict.raison }, { status: 403 });

  // Le service doit être celui de l'organisation (aucune fuite ni écriture entre organisations).
  const { data: service, error: erreurService } = await supabase.from("services").select("id").eq("id", service_id).eq("organization_id", appUser.organization_id).maybeSingle();
  if (erreurService) return NextResponse.json({ error: erreurService.message }, { status: 500 });
  if (!service) return NextResponse.json({ error: "Service introuvable dans votre organisation." }, { status: 404 });

  const { data: lues, error: erreurLecture } = await supabase
    .from("planning_entries")
    .select("id, service_id, tour_number, driver_id, vehicle_id, start_at, status, tour_open")
    .eq("organization_id", appUser.organization_id)
    .eq("service_id", service_id)
    .eq("tour_number", tour_number)
    // Marge d'un jour : instants UTC, regroupés par jour de Paris.
    .gte("start_at", `${addDays(dates[0]!, -1)}T00:00:00Z`)
    .lt("start_at", `${addDays(dates.at(-1)!, 2)}T00:00:00Z`);
  if (erreurLecture) {
    if (estSchemaManquant(erreurLecture)) return NextResponse.json({ error: MIGRATION_MANQUANTE }, { status: 503 });
    return NextResponse.json({ error: erreurLecture.message }, { status: 500 });
  }
  const existantes = (lues ?? []) as AffectationPlanning[];
  const trace = { service_id, tour_number, mode: "non_affectee" } as const;

  if (ouverte) {
    const decisions = decisionsReouverture({ dates, existantes });
    const aRouvrir = decisions.flatMap((d) => (d.type === "rouvrir" ? d.entreeIds : []));
    if (aRouvrir.length) {
      // La ligne n'a ni chauffeur ni véhicule : on la supprime, la case redevient « sans chauffeur ».
      const { data, error } = await supabase
        .from("planning_entries")
        .delete()
        .in("id", aRouvrir)
        .eq("organization_id", appUser.organization_id)
        .is("driver_id", null)
        .eq("status", "planned")
        .eq("tour_open", false)
        .select("id");
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      const rouvertes = (data ?? []).length;
      if (rouvertes) await noterModificationPlanning(appUser.organization_id, dates.map((jour) => ({ serviceId: service_id, jour })));
      if (rouvertes) await journaliser({ organizationId: appUser.organization_id, userId: appUser.id, action: "tournee_rouverte", targetTable: "planning_entries", targetId: data![0]!.id, details: { ...trace, dates: decisions.filter((d) => d.type === "rouvrir").map((d) => d.date), lignes: rouvertes } });
      return NextResponse.json({ ok: true, rouvertes });
    }
    return NextResponse.json({ ok: true, rouvertes: 0 });
  }

  const decisions = decisionsFermeture({ dates, heure, existantes, versUtc: parisWallTimeToUtcISOString });
  const maintenant = new Date().toISOString();
  const fermeture = { tour_open: false, closed_at: maintenant, closed_by: appUser.id };
  const refusees = decisions.flatMap((d) => (d.type === "affectee" ? [d.date] : []));
  const deja = decisions.filter((d) => d.type === "deja").length;
  const ids: string[] = [];

  const aCreer = decisions.flatMap((d) => (d.type === "creer" ? [d] : []));
  if (aCreer.length) {
    const { data, error } = await supabase
      .from("planning_entries")
      .upsert(
        aCreer.map((d) => ({ organization_id: appUser.organization_id, service_id, tour_number, driver_id: null, vehicle_id: null, start_at: d.startAt, status: "planned", ...fermeture })),
        { onConflict: "organization_id,service_id,tour_number,start_at", ignoreDuplicates: true },
      )
      .select("id");
    if (error) {
      if (estSchemaManquant(error)) return NextResponse.json({ error: MIGRATION_MANQUANTE }, { status: 503 });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    ids.push(...(data ?? []).map((l) => l.id as string));
  }

  const aFermer = decisions.flatMap((d) => (d.type === "fermer" ? d.entreeIds : []));
  if (aFermer.length) {
    const { data, error } = await supabase
      .from("planning_entries")
      .update(fermeture)
      .in("id", aFermer)
      .eq("organization_id", appUser.organization_id)
      .is("driver_id", null)
      .eq("status", "planned")
      .select("id");
    if (error) {
      if (estSchemaManquant(error)) return NextResponse.json({ error: MIGRATION_MANQUANTE }, { status: 503 });
      return NextResponse.json({ error: error.message, fermees: ids.length }, { status: 500 });
    }
    ids.push(...(data ?? []).map((l) => l.id as string));
  }

  if (ids.length) {
    await noterModificationPlanning(appUser.organization_id, dates.map((jour) => ({ serviceId: service_id, jour })));
    const alertesClosees = await cloreAlertesDesTournees(appUser.organization_id, ids);
    await journaliser({
      organizationId: appUser.organization_id,
      userId: appUser.id,
      action: "tournee_fermee",
      targetTable: "planning_entries",
      targetId: ids[0]!,
      details: { ...trace, dates: decisions.filter((d) => d.type === "creer" || d.type === "fermer").map((d) => d.date), lignes: ids.length, alertes_closes: alertesClosees },
    });
  }

  const fermees = ids.length;
  // Rien de fermé et des jours affectés : refus explicite (409) pour que l'écran l'affiche comme une erreur.
  if (!fermees && !deja && refusees.length) {
    return NextResponse.json({ error: "Un chauffeur est placé sur cette tournée (ou elle est démarrée) : retirez d'abord le chauffeur pour la fermer sans chauffeur.", fermees, deja, refusees }, { status: 409 });
  }
  return NextResponse.json({ ok: true, fermees, deja, refusees });
}

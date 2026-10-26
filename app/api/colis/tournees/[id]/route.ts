import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { journaliser } from "@/lib/audit/journal";
import { avecContacts, avecHoraires, avecProfessionnel, ecrireExtremitesRun, ecrireModeSimpleRun, lireExtremitesRun, lireModeSimpleRun, listesDeTournee, moduleActif, tourneeParId, STOP_FIELDS } from "@/lib/colis/serveur";
import { schemaArrivee, schemaDepart } from "@/lib/colis/extremites";
import { ecrireHeure, lireHeure } from "@/lib/colis/horaires";
import { ordonnerParListe } from "@/lib/colis/listes";
import { refusDemarrageFiche } from "@/lib/planning/ouverture-serveur";
import { refusReouverture } from "@/lib/colis/cloture";
import { estEncadrement } from "@/lib/roles/perimetre";

async function contexte(id: string) {
  const g = await garderApi({ modules: ["route_optimizer"] });
  if (!g.ok) return { erreur: g.reponse };
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return { erreur: NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 }) };
  const run = await tourneeParId(supabase, appUser, id);
  if (!run) return { erreur: NextResponse.json({ error: "Tournée introuvable." }, { status: 404 }) };
  return { supabase, run, appUser };
}

/**
 * Une tournée, ses listes et ses arrêts dans l'ordre de livraison (liste
 * après liste), chacun avec sa fiche horaires (`horaire`) si son adresse
 * figure dans l'annuaire des adresses pro de l'entreprise.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await contexte((await params).id);
  if ("erreur" in ctx) return ctx.erreur;
  const [{ data: stops }, lists, extremites, mode] = await Promise.all([
    ctx.supabase.from("delivery_stops").select(STOP_FIELDS).eq("run_id", ctx.run.id).order("position").order("created_at"),
    listesDeTournee(ctx.supabase, ctx.run.id),
    lireExtremitesRun(ctx.supabase, ctx.run.id),
    lireModeSimpleRun(ctx.supabase, ctx.run.id),
  ]);
  const ordonnes = ordonnerParListe((stops ?? []) as { id: string; list_id: string | null; position: number; address: string }[], lists);
  return NextResponse.json({ run: { ...ctx.run, optim_depart: extremites.depart, optim_arrivee: extremites.arrivee, optim_persiste: extremites.persiste, mode_simple: mode.modeSimple, mode_simple_persiste: mode.persiste }, lists, stops: await avecHoraires(ctx.supabase, ctx.appUser.organization_id, await avecContacts(ctx.supabase, await avecProfessionnel(ctx.supabase, ordonnes))) });
}

const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  status: z.enum(["loading", "in_progress", "done"]).optional(),
  return_to_start: z.boolean().optional(),
  /** Heure de départ prévue (« 07:30 ») pour les heures de passage ; null = 08:00. */
  heure_depart: z
    .string()
    .refine((v) => lireHeure(v) !== null, "Heure invalide")
    .nullable()
    .optional(),
  /** Départ / arrivée de l'optimisation (épingles 📌 comprises) ; null = choix par défaut. */
  optim_depart: schemaDepart.nullable().optional(),
  optim_arrivee: schemaArrivee.nullable().optional(),
  /** Mode simple (Livré / Non livré seulement) : modifiable tant que la tournée n'est pas clôturée. */
  mode_simple: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await contexte((await params).id);
  if ("erreur" in ctx) return ctx.erreur;
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const { heure_depart, optim_depart, optim_arrivee, mode_simple, ...champs } = parsed.data;
  if (mode_simple !== undefined && ctx.run.status === "done") return NextResponse.json({ error: "Tournée clôturée : son mode ne peut plus changer." }, { status: 409 });
  // Démarrage d'une tournée du planning fermée par l'encadrement : refusé (rien n'est supprimé, elle reprend à la réouverture).
  if (parsed.data.status === "in_progress" && ctx.run.status !== "in_progress") {
    const fermee = await refusDemarrageFiche(ctx.appUser.organization_id, ctx.run.id);
    if (fermee) return NextResponse.json({ error: fermee }, { status: 423 });
  }
  // Une tournée clôturée est figée : seul l'encadrement la rouvre, et l'action est journalisée.
  const encadrement = estEncadrement(ctx.appUser.role);
  const refusRetour = refusReouverture(ctx.run.status, parsed.data.status, encadrement);
  if (refusRetour) return NextResponse.json({ error: refusRetour }, { status: 409 });
  const update: Record<string, unknown> = { ...champs };
  if (heure_depart !== undefined) update.planned_start = heure_depart === null ? null : ecrireHeure(lireHeure(heure_depart)!);
  // Début réel de la livraison (estimation de fin) ; à la clôture, la
  // dernière position partagée est effacée (aucune conservation).
  if (parsed.data.status === "in_progress" && !(ctx.run as { started_at?: string | null }).started_at) update.started_at = new Date().toISOString();
  if (parsed.data.status && parsed.data.status !== "in_progress") Object.assign(update, { last_lat: null, last_lng: null, last_position_at: null });
  if (Object.keys(update).length) {
    const { error } = await ctx.supabase.from("delivery_runs").update(update).eq("id", ctx.run.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (ctx.run.status === "done" && parsed.data.status && parsed.data.status !== "done") {
      await journaliser({ organizationId: ctx.appUser.organization_id, userId: ctx.appUser.id, action: "tournee_colis_rouverte", targetTable: "delivery_runs", targetId: ctx.run.id, details: { nouveau_statut: parsed.data.status } });
    }
  }
  // Départ / arrivée : `persiste` faux tant que la migration n'est pas appliquée (l'appareil garde le choix).
  let persiste = true;
  if (optim_depart !== undefined || optim_arrivee !== undefined) {
    try {
      persiste = await ecrireExtremitesRun(ctx.supabase, ctx.run.id, { depart: optim_depart, arrivee: optim_arrivee });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Enregistrement impossible." }, { status: 500 });
    }
  }
  // Mode simple : `mode_simple_persiste` faux tant que la migration n'est pas appliquée (l'appareil garde le choix).
  let modePersiste = true;
  if (mode_simple !== undefined) {
    try {
      modePersiste = await ecrireModeSimpleRun(ctx.supabase, ctx.run.id, mode_simple);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Enregistrement impossible." }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true, persiste, mode_simple_persiste: modePersiste });
}

/**
 * Supprime la tournée et tous ses arrêts. Une tournée clôturée est
 * conservée dans l'historique de livraison : le chauffeur ne peut pas la
 * supprimer ; seule la direction le peut, et la suppression est journalisée
 * (journal d'audit). La base refuse aussi la suppression d'une tournée
 * clôturée hors direction (déclencheur, migration 190).
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const g2 = await garderApi({ modules: ["route_optimizer"] });
  if (!g2.ok) return g2.reponse;
  const appUser = g2.appUser;
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const direction = appUser.role === "direction";
  // La direction peut supprimer la tournée d'un chauffeur de l'entreprise ; un chauffeur, seulement la sienne.
  const { data: run } = direction
    ? await supabase.from("delivery_runs").select("id, name, run_date, status, driver_id").eq("id", id).eq("organization_id", appUser.organization_id).maybeSingle()
    : { data: await tourneeParId(supabase, appUser, id) };
  if (!run) return NextResponse.json({ error: "Tournée introuvable." }, { status: 404 });
  if (run.status === "done" && !direction) {
    return NextResponse.json({ error: "Une tournée clôturée ne peut pas être supprimée : elle est conservée dans l'historique de livraison. Seule la direction peut la supprimer." }, { status: 409 });
  }
  let details: Record<string, unknown> | null = null;
  if (run.status === "done") {
    const { data: stops } = await supabase.from("delivery_stops").select("status, parcel_count").eq("run_id", run.id);
    const s = (stops ?? []) as { status: string; parcel_count: number }[];
    details = {
      nom: (run as { name?: string | null }).name ?? null,
      date: (run as { run_date?: string }).run_date ?? null,
      chauffeur_id: (run as { driver_id?: string }).driver_id ?? null,
      arrets: s.length,
      livres: s.filter((x) => x.status === "delivered").length,
      echecs: s.filter((x) => x.status === "failed").length,
      colis: s.reduce((n, x) => n + (x.parcel_count ?? 0), 0),
    };
  }
  const { error } = await supabase.from("delivery_runs").delete().eq("id", run.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (details) {
    await journaliser({ organizationId: appUser.organization_id, userId: appUser.id, action: "tournee_colis_supprimee", targetTable: "delivery_runs", targetId: run.id, details });
  }
  return NextResponse.json({ ok: true });
}

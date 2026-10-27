import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { journaliser } from "@/lib/audit/journal";
import { garderDecision, tracerAutoValidation } from "@/lib/hierarchie/serveur";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { parisWallTimeToUtcISOString } from "@/lib/planning/dates";
import { sortieDepuisHeureParis, validerCorrection } from "@/lib/time-clock/regularisation";

const corrigerSchema = z.object({
  action: z.literal("corriger"),
  id: z.string().uuid(),
  /** Heure de sortie, heure de Paris « HH:MM » (le lendemain si elle précède l'entrée). */
  heureSortie: z.string().regex(/^\d{2}:\d{2}$/),
  motif: z.string(),
});

const ajouterSchema = z.object({
  action: z.literal("ajouter"),
  userId: z.string().uuid(),
  /** Jour (AAAA-MM-JJ) et heures de Paris du pointage oublié. */
  jour: z.string().date(),
  heureEntree: z.string().regex(/^\d{2}:\d{2}$/),
  heureSortie: z.string().regex(/^\d{2}:\d{2}$/),
  motif: z.string(),
});

const bodySchema = z.discriminatedUnion("action", [corrigerSchema, ajouterSchema]);

/**
 * Régularisation d'un pointage oublié, en un geste : saisir l'heure de sortie
 * (pointage clos automatiquement la nuit, « à régulariser »), ou ajouter un
 * pointage manquant (entrée oubliée). Motif obligatoire, trace d'audit avec
 * l'état avant / après.
 *
 * Gardes serveur : écran « Pointage » (encadrement, module Pointeuse) ; la
 * lecture du pointage passe par la RLS de la personne (manager : son service,
 * exploitation et direction : l'organisation) ; hiérarchie des demandes : on
 * ne régularise jamais son propre pointage, sauf une direction seule (tracée
 * « auto-validée »). L'écriture passe ensuite par le client service, borné à
 * l'organisation : le trigger du pointage réserve la correction d'heures à la
 * direction, et cette route est le seul chemin de l'exploitation et des managers.
 */
export async function POST(req: Request) {
  const g = await garderApi({ ecran: "equipe.pointage" });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Demande invalide (heure de sortie et motif attendus)." }, { status: 400 });
  const corps = parsed.data;
  const maintenant = new Date();
  const admin = createAdminSupabaseClient();

  if (corps.action === "corriger") {
    const { data: entree, error } = await supabase
      .from("time_clock_entries")
      .select("id, user_id, organization_id, clocked_in_at, clocked_out_at, needs_regularization, estimated_out_source")
      .eq("id", corps.id)
      .eq("organization_id", appUser.organization_id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!entree) return NextResponse.json({ error: "Pointage introuvable." }, { status: 404 });
    if (!entree.needs_regularization) return NextResponse.json({ error: "Ce pointage n'est pas à régulariser." }, { status: 409 });

    const garde = await garderDecision(supabase, appUser, entree.user_id);
    if (!garde.ok) return garde.reponse;

    const sortie = sortieDepuisHeureParis(entree.clocked_in_at, corps.heureSortie);
    if (!sortie) return NextResponse.json({ error: "Heure de sortie invalide." }, { status: 400 });
    const verdict = validerCorrection({ entree: entree.clocked_in_at, sortie, motif: corps.motif, maintenant });
    if (!verdict.ok) return NextResponse.json({ error: verdict.erreur }, { status: 422 });

    const { data: maj, error: errMaj } = await admin
      .from("time_clock_entries")
      .update({
        clocked_out_at: verdict.sortie,
        needs_regularization: false,
        regularized_at: maintenant.toISOString(),
        regularized_by: appUser.id,
        regularization_reason: verdict.motif,
      })
      .eq("id", entree.id)
      .eq("organization_id", appUser.organization_id)
      .eq("needs_regularization", true)
      .select("id");
    if (errMaj) return NextResponse.json({ error: errMaj.message }, { status: 500 });
    if (!maj?.length) return NextResponse.json({ error: "Ce pointage vient d'être régularisé." }, { status: 409 });

    await journaliser({
      organizationId: appUser.organization_id,
      userId: appUser.id,
      action: "pointage_regularise",
      targetTable: "time_clock_entries",
      targetId: entree.id,
      details: {
        salarie: entree.user_id,
        entree: entree.clocked_in_at,
        avant: { sortie: entree.clocked_out_at, source: entree.estimated_out_source },
        apres: { sortie: verdict.sortie },
        motif: verdict.motif,
        auto: garde.autoValidee,
      },
    });
    if (garde.autoValidee) await tracerAutoValidation(appUser, { table: "time_clock_entries", id: entree.id, decision: "pointage_regularise" });
    return NextResponse.json({ ok: true, sortie: verdict.sortie });
  }

  // Ajout d'un pointage manquant (entrée oubliée).
  const { data: salarie } = await supabase.from("users").select("id, role").eq("id", corps.userId).eq("organization_id", appUser.organization_id).maybeSingle();
  if (!salarie) return NextResponse.json({ error: "Salarié introuvable." }, { status: 404 });
  const garde = await garderDecision(supabase, appUser, corps.userId);
  if (!garde.ok) return garde.reponse;
  if (appUser.role === "manager") {
    // Un manager ne régularise que les salariés de ses services (la RLS du pointage borne déjà la lecture).
    const [{ data: miens }, { data: siens }] = await Promise.all([
      supabase.from("user_services").select("service_id").eq("user_id", appUser.id),
      supabase.from("user_services").select("service_id").eq("user_id", corps.userId),
    ]);
    const mes = new Set((miens ?? []).map((s: { service_id: string }) => s.service_id));
    if (!(siens ?? []).some((s: { service_id: string }) => mes.has(s.service_id))) return NextResponse.json({ error: "Cette personne n'est pas dans vos services." }, { status: 403 });
  }

  const debut = parisWallTimeToUtcISOString(corps.jour, corps.heureEntree);
  const fin = sortieDepuisHeureParis(debut, corps.heureSortie);
  if (!fin) return NextResponse.json({ error: "Heures invalides." }, { status: 400 });
  const verdict = validerCorrection({ entree: debut, sortie: fin, motif: corps.motif, maintenant });
  if (!verdict.ok) return NextResponse.json({ error: verdict.erreur }, { status: 422 });
  if (Date.parse(debut) > maintenant.getTime()) return NextResponse.json({ error: "L'entrée ne peut pas être dans le futur." }, { status: 422 });

  const { data: chevauche } = await admin
    .from("time_clock_entries")
    .select("id, clocked_in_at, clocked_out_at")
    .eq("organization_id", appUser.organization_id)
    .eq("user_id", corps.userId)
    .lt("clocked_in_at", verdict.sortie)
    .or(`clocked_out_at.is.null,clocked_out_at.gt.${debut}`)
    .limit(1);
  if (chevauche?.length) return NextResponse.json({ error: "Ce créneau chevauche un pointage existant." }, { status: 409 });

  const { data: cree, error: errAjout } = await admin
    .from("time_clock_entries")
    .insert({
      organization_id: appUser.organization_id,
      user_id: corps.userId,
      clocked_in_at: debut,
      clocked_out_at: verdict.sortie,
    })
    .select("id")
    .single();
  if (errAjout) return NextResponse.json({ error: errAjout.message }, { status: 500 });
  // Colonnes de régularisation (migration 20261109000002) : facultatives, l'ajout est déjà enregistré.
  await admin.from("time_clock_entries").update({ regularized_at: maintenant.toISOString(), regularized_by: appUser.id, regularization_reason: verdict.motif }).eq("id", cree.id).eq("organization_id", appUser.organization_id);

  await journaliser({
    organizationId: appUser.organization_id,
    userId: appUser.id,
    action: "pointage_ajoute",
    targetTable: "time_clock_entries",
    targetId: cree.id,
    details: { salarie: corps.userId, avant: null, apres: { entree: debut, sortie: verdict.sortie }, motif: verdict.motif, auto: garde.autoValidee },
  });
  if (garde.autoValidee) await tracerAutoValidation(appUser, { table: "time_clock_entries", id: cree.id, decision: "pointage_ajoute" });
  return NextResponse.json({ ok: true, id: cree.id });
}

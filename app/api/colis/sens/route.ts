import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { moduleActif } from "@/lib/colis/serveur";
import { ecrirePreferenceSens, lirePreferenceSens, orientationDeLHabitude, runPourSens, sensDeLaTournee } from "@/lib/colis/sens-serveur";
import { MODES_SENS, resumeHabitude } from "@/lib/colis/sens-tournee";

export const dynamic = "force-dynamic";

async function contexte(runId: string | null) {
  const g = await garderApi({ modules: ["route_optimizer"] });
  if (!g.ok) return { erreur: g.reponse };
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return { erreur: NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 }) };
  if (!runId || !z.string().uuid().safeParse(runId).success) return { erreur: NextResponse.json({ error: "Tournée manquante." }, { status: 400 }) };
  // Le client Supabase applique la RLS : une tournée d'un autre chauffeur n'est visible que de l'encadrement.
  const run = await runPourSens(supabase, appUser.organization_id, runId);
  if (!run) return { erreur: NextResponse.json({ error: "Tournée introuvable." }, { status: 404 }) };
  return { appUser, supabase, run };
}

async function etat(ctx: Exclude<Awaited<ReturnType<typeof contexte>>, { erreur: NextResponse }>) {
  const { supabase, appUser, run } = ctx;
  const sens = await sensDeLaTournee(supabase, appUser.organization_id, appUser.id, run);
  const depot = run.start_lat !== null && run.start_lng !== null ? { lat: Number(run.start_lat), lng: Number(run.start_lng) } : null;
  const orientation = sens.habitude ? await orientationDeLHabitude(supabase, run.id, depot, sens.habitude).catch(() => null) : null;
  return {
    /** false : ni modèle de tournée ni chauffeur, ou migration non appliquée → aucun sens mémorisé. */
    disponible: sens.scope !== null && sens.persiste,
    mode: sens.mode,
    habitude: sens.habitude
      ? { ordre: sens.habitude.ordre.map((s) => s.nom), observations: sens.habitude.observations, accord: sens.habitude.accord, orientation, libelle: resumeHabitude(sens.habitude, orientation) }
      : null,
  };
}

/** Sens habituel de la tournée (?run_id=…) et choix mémorisé : « Garder / Inverser / Ne pas en tenir compte ». */
export async function GET(req: Request) {
  const ctx = await contexte(new URL(req.url).searchParams.get("run_id"));
  if ("erreur" in ctx) return ctx.erreur;
  return NextResponse.json(await etat(ctx));
}

const postSchema = z.discriminatedUnion("action", [
  z.object({ run_id: z.string().uuid(), action: z.literal("mode"), mode: z.enum(MODES_SENS as unknown as [string, ...string[]]) }),
  /** « Oublier l'habitude » : seules les tournées clôturées à partir de maintenant compteront. */
  z.object({ run_id: z.string().uuid(), action: z.literal("oublier") }),
]);

export async function POST(req: Request) {
  const body = postSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const ctx = await contexte(body.data.run_id);
  if ("erreur" in ctx) return ctx.erreur;
  const { supabase, appUser, run } = ctx;
  const sens = await sensDeLaTournee(supabase, appUser.organization_id, appUser.id, run);
  if (!sens.scope) return NextResponse.json({ error: "Cette tournée n'a pas de sens habituel (aucun modèle de tournée ni chauffeur)." }, { status: 409 });
  const pref = await lirePreferenceSens(supabase, appUser.organization_id, sens.scope);
  try {
    const ok = await ecrirePreferenceSens(supabase, appUser.organization_id, appUser.id, sens.scope, pref, body.data.action === "mode" ? { mode: body.data.mode as "habituel" | "inverse" | "libre" } : { reset_at: new Date().toISOString(), historique: [], mode: "habituel" });
    if (!ok) return NextResponse.json({ error: "Le sens habituel sera disponible après la mise à jour de la base." }, { status: 503 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Enregistrement impossible." }, { status: 500 });
  }
  return NextResponse.json(await etat(ctx));
}

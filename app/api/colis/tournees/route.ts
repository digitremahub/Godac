import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { aujourdhuiParis, ecrireModeSimpleRun, listerTournees, moduleActif } from "@/lib/colis/serveur";
import { preparerFicheDuJour } from "@/lib/colis/fiche-du-jour";

/** Tournées colis du chauffeur connecté (jour en cours + non clôturées de la semaine). */
export async function GET() {
  const g = await garderApi({ modules: ["route_optimizer"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  return NextResponse.json({ tournees: await listerTournees(supabase, appUser) });
}

const bodySchema = z.object({ name: z.string().trim().max(60).nullable().optional(), mode_simple: z.boolean().optional() });

/**
 * « Nouvelle tournée » : une fiche séparée par tournée planifiée du jour
 * encore sans fiche (la première est renvoyée), sinon reprise de la fiche
 * ouverte, sinon fiche libre (lib/colis/fiche-du-jour.ts › preparerFicheDuJour).
 */
export async function POST(req: Request) {
  const g2 = await garderApi({ modules: ["route_optimizer"] });
  if (!g2.ok) return g2.reponse;
  const appUser = g2.appUser;
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Nom invalide." }, { status: 400 });
  try {
    const fiche = await preparerFicheDuJour(supabase, appUser, aujourdhuiParis(), parsed.data.name ?? null);
    // Mode choisi à la création : appliqué à la fiche créée seulement (une fiche reprise garde son mode).
    let modePersiste = true;
    if (parsed.data.mode_simple !== undefined && !fiche.reused && fiche.run?.id) {
      modePersiste = await ecrireModeSimpleRun(supabase, fiche.run.id, parsed.data.mode_simple).catch(() => false);
    }
    return NextResponse.json({ ...fiche, mode_simple: !fiche.reused && parsed.data.mode_simple === true, mode_simple_persiste: modePersiste });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Création impossible" }, { status: 500 });
  }
}

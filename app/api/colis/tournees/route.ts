import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { creerTournee, listerTournees, moduleActif } from "@/lib/colis/serveur";

/** Tournées colis du chauffeur connecté (jour en cours + non clôturées de la semaine). */
export async function GET() {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  return NextResponse.json({ tournees: await listerTournees(supabase, appUser) });
}

const bodySchema = z.object({ name: z.string().trim().max(60).nullable().optional() });

/** Nouvelle tournée colis du jour (on peut en faire plusieurs). */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Nom invalide." }, { status: 400 });
  try {
    return NextResponse.json({ run: await creerTournee(supabase, appUser, parsed.data.name ?? null) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Création impossible" }, { status: 500 });
  }
}

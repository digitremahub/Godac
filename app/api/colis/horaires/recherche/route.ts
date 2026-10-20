import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { moduleActif, tourneeParId } from "@/lib/colis/serveur";
import { codePays } from "@/lib/pays/serveur";
import { rechercherEtEnregistrerHoraires } from "@/lib/colis/horaires-internet";

export const maxDuration = 60;

const bodySchema = z.object({
  run_id: z.string().uuid(),
  /** Arrêts à examiner ; absents : ceux de la tournée jamais examinés (40 au plus). */
  stop_ids: z.array(z.string().uuid()).max(40).optional(),
});

/**
 * Détection des adresses pro et recherche de leurs horaires sur internet,
 * appelée par l'écran juste après un ajout (scan, photo, saisie, import),
 * sans bloquer l'ajout lui-même. Les horaires trouvés sont enregistrés dans
 * l'annuaire de l'entreprise (source OpenStreetMap ou Google), jamais à la
 * place d'une fiche saisie à la main.
 */
export async function POST(req: Request) {
  const g = await garderApi({ modules: ["route_optimizer"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (!hasRole(appUser.role, ["chauffeur", "manager", "direction"])) return NextResponse.json({ error: "Réservé aux chauffeurs et à l'encadrement." }, { status: 403 });
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const run = await tourneeParId(supabase, appUser, parsed.data.run_id);
  if (!run) return NextResponse.json({ error: "Tournée introuvable." }, { status: 404 });

  let q = supabase.from("delivery_stops").select("id, address, recipient, lat, lng, kind, business_name, hours_lookup_at").eq("run_id", run.id).eq("status", "pending");
  if (parsed.data.stop_ids?.length) q = q.in("id", parsed.data.stop_ids);
  else q = q.is("hours_lookup_at", null);
  const { data, error } = await q.limit(40);
  // Migration 190 non appliquée : pas de recherche (aucune erreur côté chauffeur).
  if (error) return NextResponse.json({ resultats: [], indisponible: true });
  const resultats = await rechercherEtEnregistrerHoraires(supabase, appUser.organization_id, appUser.id, (data ?? []) as any[], {
    budgetMs: 40000,
    pays: await codePays(appUser.organization_id),
  });
  return NextResponse.json({ resultats });
}

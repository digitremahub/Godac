import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { dansLePerimetre } from "@/lib/roles/perimetre";
import { rangJour } from "@/lib/planning/semaine";
import { instantParis } from "@/lib/planning/semaines-auto";
import { genererSemaine } from "@/lib/planning/semaines-auto-serveur";

const bodySchema = z.object({
  service_id: z.string().uuid(),
  semaine_debut: z.string().date().refine((d) => rangJour(d) === 0, "La semaine commence un lundi."),
});

/**
 * « Régénérer les cases vides » : relance la génération de la semaine d'un service
 * sans rien écraser (affectations, fermetures, modifications restent) ; seules les
 * cases encore vides sont remplies (copie de la semaine précédente, modèles).
 * C'est une action manuelle : la semaine est notée « modifiée », elle n'est donc
 * pas envoyée toute seule le vendredi. Semaine à venir uniquement, tant qu'elle n'est
 * pas publiée. Direction et exploitation : toute l'organisation ; manager : son service.
 */
export async function POST(req: Request) {
  const g = await garderApi({ roles: ["direction", "exploitation", "manager"], modules: ["planning"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const { service_id, semaine_debut } = parsed.data;
  if (semaine_debut <= instantParis(new Date()).jour) return NextResponse.json({ error: "Seule une semaine à venir peut être régénérée." }, { status: 400 });

  const { data: liens } = await g.supabase.from("user_services").select("service_id").eq("user_id", appUser.id);
  if (!dansLePerimetre(appUser.role, ((liens ?? []) as { service_id: string }[]).map((l) => l.service_id), service_id)) {
    return NextResponse.json({ error: "Ce service ne fait pas partie de vos services." }, { status: 403 });
  }

  let admin: ReturnType<typeof createAdminSupabaseClient>;
  try {
    admin = createAdminSupabaseClient();
  } catch {
    return NextResponse.json({ error: "Génération indisponible (configuration du serveur)." }, { status: 500 });
  }
  try {
    const bilan = await genererSemaine(admin, appUser.organization_id, { lundi: semaine_debut, serviceId: service_id, regenerer: true, userId: appUser.id });
    if (bilan.migrationManquante) return NextResponse.json({ error: bilan.message }, { status: 503 });
    const s = bilan.services[0];
    if (!s) return NextResponse.json({ error: "Service introuvable dans votre organisation." }, { status: 404 });
    if (s.statut === "erreur") return NextResponse.json({ error: s.message ?? "Génération impossible." }, { status: 500 });
    if (s.statut === "publiee") return NextResponse.json({ error: s.message }, { status: 409 });
    return NextResponse.json({ ok: true, statut: s.statut, cases_creees: s.creees ?? 0, message: s.message ?? null });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Génération impossible." }, { status: 500 });
  }
}

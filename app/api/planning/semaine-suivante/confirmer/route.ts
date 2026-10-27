import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { dansLePerimetre } from "@/lib/roles/perimetre";
import { rangJour } from "@/lib/planning/semaine";
import { lireSuivi } from "@/lib/planning/suivi-auto-serveur";
import { confirmerSemaine } from "@/lib/planning/semaines-auto-serveur";

const bodySchema = z.object({
  service_id: z.string().uuid(),
  /** Lundi de la semaine générée automatiquement. */
  semaine_debut: z.string().date().refine((d) => rangJour(d) === 0, "La semaine commence un lundi."),
  /** « Envoyer quand même » : confirmation explicite malgré des cases à remplacer. */
  envoyer_quand_meme: z.boolean().optional(),
});

/**
 * « Confirmer et envoyer aux chauffeurs » : publie IMMÉDIATEMENT la semaine
 * générée automatiquement pour un service (lib/planning/publication-serveur.ts ›
 * publierSemaines, la même fonction que « Publier aux chauffeurs »), avec la
 * notification de chaque chauffeur concerné. Refusée (409, code cases_a_remplacer)
 * s'il reste des cases sans chauffeur, sauf `envoyer_quand_meme`.
 * Direction et exploitation : toute l'organisation ; manager : son service ;
 * jamais le chauffeur ni le comptable. Tracé au journal d'audit.
 */
export async function POST(req: Request) {
  const g = await garderApi({ roles: ["direction", "exploitation", "manager"], modules: ["planning"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const { service_id, semaine_debut, envoyer_quand_meme } = parsed.data;

  const { data: liens } = await g.supabase.from("user_services").select("service_id").eq("user_id", appUser.id);
  if (!dansLePerimetre(appUser.role, ((liens ?? []) as { service_id: string }[]).map((l) => l.service_id), service_id)) {
    return NextResponse.json({ error: "Ce service ne fait pas partie de vos services." }, { status: 403 });
  }

  let admin: ReturnType<typeof createAdminSupabaseClient>;
  try {
    admin = createAdminSupabaseClient();
  } catch {
    return NextResponse.json({ error: "Envoi indisponible (configuration du serveur)." }, { status: 500 });
  }
  const suivi = await lireSuivi(admin, appUser.organization_id, { lundi: semaine_debut, serviceIds: [service_id] });
  if (!suivi.ok) {
    if (suivi.tableAbsente) return NextResponse.json({ error: "Suivi des semaines générées indisponible : migration pas encore appliquée." }, { status: 503 });
    return NextResponse.json({ error: suivi.error }, { status: 500 });
  }
  const ligne = suivi.lignes[0];
  if (!ligne) return NextResponse.json({ error: "Aucune semaine générée automatiquement pour ce service." }, { status: 404 });

  const r = await confirmerSemaine({ db: g.supabase, admin, organizationId: appUser.organization_id, userId: appUser.id, ligne, envoyerQuandMeme: Boolean(envoyer_quand_meme) });
  if (!r.ok) return NextResponse.json({ error: r.error, code: r.code, cases_a_remplacer: r.casesARemplacer }, { status: r.status });
  return NextResponse.json({ ok: true, sent: r.sent, cases_a_remplacer: r.casesARemplacer });
}

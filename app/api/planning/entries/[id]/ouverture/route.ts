import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { journaliser } from "@/lib/audit/journal";
import { compterDirection, tracerAutoValidation } from "@/lib/hierarchie/serveur";
import { confirmationFermeture, peutChangerOuverture } from "@/lib/planning/ouverture";
import { fichesEnCoursDe } from "@/lib/planning/ouverture-serveur";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";

const bodySchema = z.object({
  /** true : rouvrir ; false : fermer. */
  ouverte: z.boolean(),
  /** Réponse à la question « la tournée colis liée est en cours, fermer quand même ? » (409 confirmation_requise). */
  confirmer_en_cours: z.boolean().optional(),
});

/**
 * Fermer ou rouvrir une tournée du planning (planning_entries.tour_open,
 * migration 20261105000001). Fermée : plus de changement d'affectation et
 * plus de démarrage côté chauffeur ; rouvrir rétablit tout. Rien n'est
 * supprimé. Droits : lib/planning/ouverture.ts › peutChangerOuverture
 * (direction, exploitation, manager de son service ; jamais sa propre
 * tournée). RLS : l'écriture reste bornée au service. Tracé au journal d'audit.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Affectation invalide." }, { status: 400 });
  const g = await garderApi({ modules: ["planning"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const { ouverte, confirmer_en_cours } = parsed.data;

  const supabase = await createServerSupabaseClient();
  // Lecture sous la RLS : une affectation hors de la portée de la personne reste introuvable.
  const { data: entree, error: erreurLecture } = await supabase
    .from("planning_entries")
    .select("id, service_id, driver_id, status, tour_number, start_at, tour_open")
    .eq("id", id)
    .eq("organization_id", appUser.organization_id)
    .maybeSingle();
  if (erreurLecture) {
    if (estSchemaManquant(erreurLecture)) return NextResponse.json({ error: "Ouvrir et fermer les tournées demande une mise à jour de la base (migration pas encore appliquée)." }, { status: 503 });
    return NextResponse.json({ error: erreurLecture.message }, { status: 500 });
  }
  if (!entree) return NextResponse.json({ error: "Affectation introuvable." }, { status: 404 });

  const [{ data: liens }, directionCount] = await Promise.all([
    supabase.from("user_services").select("service_id").eq("user_id", appUser.id),
    compterDirection(supabase, appUser.organization_id),
  ]);
  const verdict = peutChangerOuverture({
    role: appUser.role,
    userId: appUser.id,
    serviceIds: ((liens ?? []) as { service_id: string }[]).map((l) => l.service_id),
    entree: entree as { service_id: string; driver_id: string | null; status: string },
    directionCount,
  });
  if (!verdict.ok) return NextResponse.json({ error: verdict.raison }, { status: 403 });

  if ((entree.tour_open !== false) === ouverte) return NextResponse.json({ ok: true, tour_open: ouverte, inchangee: true });

  // Fermer une tournée dont la fiche colis est en cours : confirmation d'abord (rien n'est supprimé).
  if (!ouverte && !confirmer_en_cours) {
    // delivery_run_id n'existe qu'avec la migration 20261023000002 : lecture à part, tolérante.
    const { data: portee } = await supabase.from("planning_entries").select("delivery_run_id").eq("id", id).maybeSingle();
    const question = confirmationFermeture(await fichesEnCoursDe(supabase, appUser.organization_id, id, (portee as { delivery_run_id?: string | null } | null)?.delivery_run_id ?? null));
    if (question) return NextResponse.json({ confirmation_requise: true, message: question }, { status: 409 });
  }

  const maintenant = new Date().toISOString();
  const { data, error } = await supabase
    .from("planning_entries")
    .update(ouverte ? { tour_open: true, closed_at: null, closed_by: null } : { tour_open: false, closed_at: maintenant, closed_by: appUser.id })
    .eq("id", id)
    .eq("organization_id", appUser.organization_id)
    .select("id, tour_open, closed_at, closed_by")
    .maybeSingle();
  if (error) {
    if (estSchemaManquant(error)) return NextResponse.json({ error: "Ouvrir et fermer les tournées demande une mise à jour de la base (migration pas encore appliquée)." }, { status: 503 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Affectation introuvable ou hors de votre service." }, { status: 404 });

  await journaliser({
    organizationId: appUser.organization_id,
    userId: appUser.id,
    action: ouverte ? "tournee_rouverte" : "tournee_fermee",
    targetTable: "planning_entries",
    targetId: id,
    details: { tour_number: entree.tour_number, start_at: entree.start_at, driver_id: entree.driver_id, ...(confirmer_en_cours ? { fiche_en_cours_confirmee: true } : {}) },
  });
  if (verdict.autoValidee) await tracerAutoValidation(appUser, { table: "planning_entries", id, decision: ouverte ? "réouverture" : "fermeture" });

  return NextResponse.json({ ok: true, tour_open: data.tour_open, closed_at: data.closed_at, closed_by: data.closed_by });
}

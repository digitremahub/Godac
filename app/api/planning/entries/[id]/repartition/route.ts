import { NextResponse } from "next/server";
import { z } from "zod";
import { journaliser } from "@/lib/audit/journal";
import { resynchroniserFiches } from "@/lib/colis/fusion-fiches";
import { FILTRE_CONDUCTEURS } from "@/lib/roles/conducteurs";
import { appliquerAttributions, resumeRepartition, texteAAttribuer } from "@/lib/planning/fusion";
import { chauffeursDeLaFusion, ecrireRepartition } from "@/lib/planning/fusion-serveur";
import { garderFusion, reponseErreurFusion } from "@/lib/planning/fusion-acces";

const attributionSchema = z.object({
  kind: z.enum(["village", "ramasse"]),
  cle: z.string().min(1).max(300),
  /** Chauffeur et tournée réelle vides : l'élément redevient « À attribuer ». */
  driver_id: z.string().uuid().nullable(),
  route_id: z.string().uuid().nullable().optional(),
});
const putSchema = z.object({ attributions: z.array(attributionSchema).min(1).max(500) });

/**
 * Répartition PROVISOIRE des villages et des ramasses d'une tournée fusionnée
 * entre les chauffeurs / tournées réelles (planning_entry_repartition). Un
 * élément sans chauffeur ni tournée reste « À attribuer ». Les fiches Tournée
 * colis déjà créées sont remises en phase (lib/colis/fusion-fiches.ts) sans
 * jamais supprimer ce qui est commencé. Tracé au journal d'audit.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await garderFusion((await params).id);
  if (!ctx.ok) return ctx.reponse;
  const { appUser, supabase, entree, fusion } = ctx;
  if (!fusion) return NextResponse.json({ error: "Cette tournée n'est pas marquée comme fusionnée." }, { status: 409 });
  if (entree.status === "done" || entree.status === "cancelled") return NextResponse.json({ error: "Tournée terminée ou annulée : la répartition ne change plus." }, { status: 409 });
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });

  // Chauffeurs et tournées désignés : de l'organisation, sans fuite d'une autre.
  const drivers = [...new Set(parsed.data.attributions.map((a) => a.driver_id).filter((x): x is string => Boolean(x)))];
  const routes = [...new Set(parsed.data.attributions.map((a) => a.route_id).filter((x): x is string => Boolean(x)))];
  const [{ data: users }, { data: tournees }] = await Promise.all([
    drivers.length ? supabase.from("users").select("id").eq("organization_id", appUser.organization_id).eq("active", true).or(FILTRE_CONDUCTEURS).in("id", drivers) : Promise.resolve({ data: [] }),
    routes.length ? supabase.from("tour_routes").select("id").eq("organization_id", appUser.organization_id).in("id", routes) : Promise.resolve({ data: [] }),
  ]);
  if ((users ?? []).length !== drivers.length) return NextResponse.json({ error: "Chauffeur introuvable ou inactif dans votre organisation." }, { status: 400 });
  if ((tournees ?? []).length !== routes.length) return NextResponse.json({ error: "Tournée introuvable." }, { status: 400 });

  const tous = [...fusion.elements.villages, ...fusion.elements.ramasses];
  const attributions = parsed.data.attributions.map((a) => ({ ...a, route_id: a.route_id ?? null, label: tous.find((e) => e.kind === a.kind && e.cle === a.cle)?.label ?? a.cle }));
  // Un élément inconnu de la fusion est ignoré : on le dit plutôt que de faire croire que tout est enregistré.
  const connus = attributions.filter((a) => tous.some((e) => e.kind === a.kind && e.cle === a.cle));
  if (!connus.length) return NextResponse.json({ error: "Ces villages et ramasses ne font pas partie de cette tournée fusionnée." }, { status: 400 });
  const changement = appliquerAttributions(tous, fusion.lignes, connus);
  if (!changement.ecrire.length && !changement.supprimer.length) {
    return NextResponse.json({ ok: true, modifies: 0, lignes: fusion.lignes, resume: resumeRepartition(tous, fusion.lignes), warning: null });
  }

  const r = await ecrireRepartition(supabase, appUser.organization_id, appUser.id, fusion, connus);
  if (r.erreur) return reponseErreurFusion({ message: r.erreur });

  // Chauffeur désigné sans la tournée dans son planning ce jour-là : sa fiche ne pourra pas la charger.
  const surLaTournee = await chauffeursDeLaFusion(supabase, appUser.organization_id, entree);
  const sansTournee = drivers.filter((d) => !surLaTournee.includes(d));
  const bilan = await resynchroniserFiches(appUser.organization_id, { ...fusion, lignes: r.lignes }, entree);
  const resume = resumeRepartition(tous, r.lignes);
  await journaliser({
    organizationId: appUser.organization_id,
    userId: appUser.id,
    action: "tournee_repartition_modifiee",
    targetTable: "planning_entries",
    targetId: entree.id,
    details: { tour_number: entree.tour_number, start_at: entree.start_at, elements: r.modifies, a_attribuer: resume.aAttribuer, fiches_retirees: bilan.retires, fiches_conservees: bilan.conserves },
  });
  const warning =
    [
      sansTournee.length ? `${sansTournee.length > 1 ? "Des chauffeurs ne sont" : "Un chauffeur n'est"} pas sur cette tournée ce jour-là au planning : placez-${sansTournee.length > 1 ? "les" : "le"} dessus pour que sa fiche colis la charge.` : null,
      bilan.avertissement,
    ]
      .filter(Boolean)
      .join(" ") || null;
  return NextResponse.json({ ok: true, modifies: r.modifies, lignes: r.lignes, resume, texte: texteAAttribuer(resume), warning });
}

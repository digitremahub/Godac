import { garderPage } from "@/lib/acces/garde-page";
import { PageHeader, EmptyState } from "@/components/ui";
import { NewFineForm } from "@/components/fines/NewFineForm";
import { FinesTable, type CandidatVue, type FineRow } from "@/components/fines/FinesTable";
import { JaugesQuotas } from "@/components/acces/JaugesQuotas";
import { FILTRE_CONDUCTEURS } from "@/lib/roles/conducteurs";
import { lireCommentaires } from "@/lib/rattachement/commentaires-serveur";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { contexteHierarchie, rolesParId } from "@/lib/hierarchie/serveur";

const COLONNES =
  "id, infraction_at, amount, reference, status, notified_at, photo_path, driver_id, vehicles(registration), driver:users!fines_driver_id_fkey(full_name), matched:planning_entries!fines_matched_planning_entry_id_fkey(tour_number, driver_id, users!planning_entries_driver_id_fkey(full_name))";
const COLONNES_NOUVELLES = ", document_paths, location, reduced_amount, payment_deadline, suggested_driver_id, match_confidence, match_details, validated_at, validated_by";

/**
 * Amendes : avis obligatoire (photo / PDF), responsable suggéré par
 * rapprochement avec le planning (lib/rattachement), validé par
 * l'encadrement puis notifié au chauffeur. Direction partout, managers sur
 * les véhicules de leur service (RLS), comptable en lecture seule.
 */
export default async function FinesPage({ searchParams }: { searchParams: Promise<{ amende?: string }> }) {
  const g = await garderPage("flotte.amendes");
  if (!g.ok) return g.ecran;
  const { appUser, supabase } = g;
  const { amende: focusId } = await searchParams;
  const lectureSeule = appUser.role === "comptable";

  const listeAmendes = (colonnes: string) => supabase.from("fines").select(colonnes).order("infraction_at", { ascending: false }).limit(200);
  const [{ data: vehicles }, premier, { data: users }] = await Promise.all([
    supabase.from("vehicles").select("id, registration").order("registration"),
    listeAmendes(COLONNES + COLONNES_NOUVELLES),
    lectureSeule ? Promise.resolve({ data: [] as { id: string; full_name: string; role: string }[] }) : supabase.from("users").select("id, full_name, role").eq("active", true).or(FILTRE_CONDUCTEURS).order("full_name"),
  ]);
  // Migration 20261026000003 non appliquée : colonnes historiques.
  const lecture = premier.error && estSchemaManquant(premier.error) ? await listeAmendes(COLONNES) : premier;
  const brutes = (lecture.data ?? []) as any[];

  const noms = new Map((users ?? []).map((u) => [u.id, u.full_name]));
  const valideurs = [...new Set(brutes.map((f) => f.validated_by).filter(Boolean))].filter((id) => !noms.has(id));
  if (valideurs.length) {
    const { data } = await supabase.from("users").select("id, full_name").in("id", valideurs);
    for (const u of data ?? []) noms.set(u.id, u.full_name);
  }
  // Hiérarchie des demandes : le chauffeur désigné est le « demandeur » ; on ne règle pas sa propre amende.
  const { directionCount } = await contexteHierarchie(supabase, appUser.organization_id);
  const rolesDesignes = await rolesParId(supabase, appUser.organization_id, brutes.map((f) => f.driver_id).filter(Boolean));
  const commentaires = await lireCommentaires(supabase, "fine", brutes.map((f) => f.id));

  const fines: FineRow[] = brutes.map((f) => {
    const details = (f.match_details ?? null) as { raison?: string; candidats?: CandidatVue[] } | null;
    const candidats = details?.candidats ?? [];
    const suggestedId: string | null = f.suggested_driver_id ?? f.matched?.driver_id ?? null;
    const docs = Array.isArray(f.document_paths) && f.document_paths.length ? f.document_paths.length : f.photo_path ? 1 : 0;
    return {
      id: f.id,
      infraction_at: f.infraction_at,
      amount: Number(f.amount),
      reduced_amount: f.reduced_amount !== null && f.reduced_amount !== undefined ? Number(f.reduced_amount) : null,
      payment_deadline: f.payment_deadline ?? null,
      location: f.location ?? null,
      reference: f.reference,
      status: f.status,
      notified_at: f.notified_at,
      vehicles: f.vehicles,
      driver_id: f.driver_id,
      driver_role: f.driver_id ? (rolesDesignes.get(f.driver_id) ?? "chauffeur") : null,
      driver: f.driver,
      suggested_driver_id: suggestedId,
      suggested_driver_name: candidats.find((c) => c.driverId === suggestedId)?.driverName ?? f.matched?.users?.full_name ?? (suggestedId ? (noms.get(suggestedId) ?? null) : null),
      suggested_tour_number: f.matched?.tour_number ?? null,
      match_confidence: f.match_confidence ?? (f.matched ? "exact" : null),
      raison: details?.raison ?? null,
      candidats,
      documents: docs,
      validated_at: f.validated_at ?? null,
      validated_by_name: f.validated_by ? (noms.get(f.validated_by) ?? null) : null,
      commentaires: (commentaires.get(f.id) ?? []).map((c) => ({ id: c.id, auteur: c.auteur, auteurId: c.auteurId, texte: c.texte, photos: c.photos, creeLe: c.creeLe })),
    };
  });

  return (
    <div>
      <PageHeader
        title="Amendes"
        description="Avis joint obligatoire, responsable suggéré d'après le planning du véhicule — validez-le pour le notifier au chauffeur."
      />
      <JaugesQuotas organizationId={appUser.organization_id} role={appUser.role} fonctions={["ocr_fine"]} />
      {!lectureSeule && (
        <div className="mb-4">
          <NewFineForm vehicles={vehicles ?? []} />
        </div>
      )}
      {fines.length === 0 ? (
        <EmptyState title="Aucune amende" description="Les amendes enregistrées apparaîtront ici." />
      ) : (
        <FinesTable
          fines={fines}
          lectureSeule={lectureSeule}
          chauffeurs={(users ?? []).map((u) => ({ id: u.id, name: u.full_name, role: u.role }))}
          moi={appUser.id}
          moiRole={appUser.role}
          directionCount={directionCount}
          focusId={focusId ?? null}
        />
      )}
    </div>
  );
}

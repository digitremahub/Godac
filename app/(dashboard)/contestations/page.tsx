import { garderPage } from "@/lib/acces/garde-page";
import { hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader, EmptyState } from "@/components/ui";
import { Contestations, type Contestation } from "@/components/contestations/Contestations";
import { libelleLieu, libellePreuve } from "@/lib/colis/livraison";

/**
 * Contestations clients. L'encadrement importe la réclamation, valide le
 * chauffeur et clôture ; le chauffeur voit celles qui lui sont attribuées
 * (RLS) et y répond.
 */
export default async function ContestationsPage() {
  const g = await garderPage("exploitation.contestations");
  if (!g.ok) return g.ecran;
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();
  const [actif, ocr] = await Promise.all([
    isModuleEnabled(supabase, appUser.organization_id, "customer_disputes"),
    isModuleEnabled(supabase, appUser.organization_id, "ocr"),
  ]);
  if (!actif) return <EmptyState title="Module Contestations clients non activé" description="La direction peut l'activer depuis Modules & tarifs." />;
  const encadrement = hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"]);

  const [{ data: rows }, { data: users }] = await Promise.all([
    supabase.from("customer_disputes").select("*, driver:users!customer_disputes_driver_id_fkey(full_name), stop:delivery_stops(id, proof_photo_path, proof_code, delivered_place, done_at, kind, relay_name, packages_picked_up)").order("created_at", { ascending: false }).limit(200),
    encadrement
      ? supabase.from("users").select("id, full_name").eq("active", true).in("role", ["chauffeur", "manager_chauffeur"]).order("full_name")
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);

  const contestations: Contestation[] = ((rows ?? []) as any[])
    .filter((r) => encadrement || r.driver_id === appUser.id)
    .map((r) => ({
      id: r.id,
      status: r.status,
      has_document: Boolean(r.document_path),
      preuve: r.stop
        ? { stopId: r.stop.id, photo: Boolean(r.stop.proof_photo_path), lieu: libelleLieu(r.stop.delivered_place), relais: r.stop.delivered_place === "point_relais" ? libellePreuve(r.stop) : null, code: r.stop.proof_code ?? null, livreLe: r.stop.done_at }
        : null,
      client_name: r.client_name,
      reference: r.reference,
      parcel_code: r.parcel_code,
      delivery_address: r.delivery_address,
      delivery_date: r.delivery_date,
      tour_number: r.tour_number,
      reason: r.reason,
      claimed_amount: r.claimed_amount !== null ? Number(r.claimed_amount) : null,
      suggested_driver_id: r.suggested_driver_id,
      suggestion_reason: r.suggestion_reason,
      driver_id: r.driver_id,
      driver_name: r.driver?.full_name ?? null,
      driver_response: r.driver_response,
      responded_at: r.responded_at,
      resolution_note: r.resolution_note,
      created_at: r.created_at,
    }));

  return (
    <div>
      <PageHeader
        title="Contestations clients"
        description={
          encadrement
            ? "Réclamations lues automatiquement, rattachées au chauffeur concerné après votre validation, puis suivies jusqu'à leur règlement."
            : "Les réclamations clients qui vous concernent : expliquez ce qui s'est passé pour aider à les régler."
        }
      />
      <Contestations
        contestations={contestations}
        encadrement={encadrement}
        chauffeurs={(users ?? []).map((u) => ({ id: u.id, name: u.full_name }))}
        organizationId={appUser.organization_id}
        lectureAuto={ocr}
      />
    </div>
  );
}

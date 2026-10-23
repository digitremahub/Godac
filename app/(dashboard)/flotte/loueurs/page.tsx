import { garderPage } from "@/lib/acces/garde-page";
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader, StatTile } from "@/components/ui";
import { RentalRequestsList } from "@/components/rental/RentalRequestsList";
import { loadRentalRequests } from "@/lib/rental/load-requests";
import { RENTAL_REQUEST_STATUSES, RENTAL_STATUS_LABELS } from "@/lib/rental/workflow";

export default async function RentalRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ statut?: string; loueur?: string; vehicule?: string }>;
}) {
  const g = await garderPage("flotte.loueurs_demandes");
  if (!g.ok) return g.ecran;
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();
  const sp = await searchParams;
  const status = RENTAL_REQUEST_STATUSES.includes(sp.statut as any) ? sp.statut : undefined;
  const uuid = /^[0-9a-f-]{36}$/i;
  const providerId = sp.loueur && uuid.test(sp.loueur) ? sp.loueur : undefined;
  const vehicleId = sp.vehicule && uuid.test(sp.vehicule) ? sp.vehicule : undefined;

  const [requests, { data: providers }, { data: vehicles }, { data: counts }] = await Promise.all([
    loadRentalRequests(supabase, { status, providerId, vehicleId }, 200, { id: appUser.id, role: appUser.role, organizationId: appUser.organization_id }),
    supabase.from("rental_providers").select("id, name").order("name"),
    supabase.from("vehicles").select("id, registration").neq("ownership", "propre").order("registration"),
    supabase.from("rental_maintenance_requests").select("status"),
  ]);
  const count = (s: string) => (counts ?? []).filter((c) => c.status === s).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Demandes transmises aux loueurs"
        description="Demandes d'entretien des véhicules loués : validation par un responsable, puis envoi au loueur ou au garage prestataire, qui répond par lien sécurisé."
        actions={
          <Link href="/flotte/loueurs/prestataires" className="btn-secondary">
            Loueurs & prestataires
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="À valider" value={String(count("a_valider"))} accent="gold" />
        <StatTile label="Transmises" value={String(count("transmise") + count("validee"))} />
        <StatTile label="Planifiées" value={String(count("planifiee"))} />
        <StatTile label="Terminées" value={String(count("terminee"))} />
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          Statut
          <select name="statut" defaultValue={status ?? ""} className="input mt-1 !w-auto">
            <option value="">Tous</option>
            {RENTAL_REQUEST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {RENTAL_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Loueur / prestataire
          <select name="loueur" defaultValue={providerId ?? ""} className="input mt-1 !w-auto">
            <option value="">Tous</option>
            {(providers ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Véhicule
          <select name="vehicule" defaultValue={vehicleId ?? ""} className="input mt-1 !w-auto">
            <option value="">Tous</option>
            {(vehicles ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.registration}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn-secondary">
          Filtrer
        </button>
        {(status || providerId || vehicleId) && (
          <Link href="/flotte/loueurs" className="text-sm text-teal-ink hover:underline">
            Réinitialiser
          </Link>
        )}
      </form>

      <RentalRequestsList requests={requests} />
    </div>
  );
}

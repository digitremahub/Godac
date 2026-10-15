import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireAppUser, hasRole } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader, Card } from "@/components/ui";
import { FuelHistoryTable } from "@/components/fuel/FuelHistoryTable";
import { FuelHistoryFilters } from "@/components/fuel/FuelHistoryFilters";
import { NewFuelEntryWizard } from "@/components/fuel/NewFuelEntryWizard";
import { nextDay, parisMidnightIso } from "@/lib/utils/paris-time";

const PAGE_SIZE = 50;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "Carburant" (historique) et "Nouveau ravitaillement" (l'assistant de
 * plein) réunis sur une seule route — ex-/fuel/new. `?new=1` est le
 * seul interrupteur qui bascule vers l'assistant : vehicle/driver sont
 * déjà réutilisés par les filtres d'historique ci-dessous, donc ça ne
 * peut pas être leur simple présence qui décide (un lien "⛽ Plein"
 * depuis une fiche véhicule, un scan QR cuve/badge chauffeur, ou le
 * bouton "Plein" de la barre mobile chauffeur passent désormais tous
 * ?new=1 en plus de leurs propres paramètres).
 */
export default async function FuelPage({
  searchParams,
}: {
  searchParams: Promise<{ vehicle?: string; driver?: string; status?: string; tank?: string; new?: string; from?: string; to?: string; page?: string }>;
}) {
  const params = await searchParams;
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  const wizardMode = Boolean(params.new);
  const canSeeOtherDrivers = hasRole(appUser.role, ["manager", "manager_chauffeur", "direction", "comptable"]);
  const canCreate = hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"]);
  // Un manager_chauffeur est lui-même chauffeur — "soi-même" reste un
  // choix valide par défaut. Un manager/la direction ne le sont jamais :
  // les laisser sur ce défaut soumettrait le plein au nom de leur
  // propre compte (jamais un vrai chauffeur), d'où le champ vide forcé
  // ci-dessous pour ces deux rôles tant qu'un employé n'est pas choisi.
  const selfIsDriver = hasRole(appUser.role, ["chauffeur", "manager_chauffeur"]);

  if (wizardMode) {
    const [{ data: vehicles }, { data: tanks }, ocrEnabled, { data: assignedVehicle }, { data: driver }, { data: employees }] = await Promise.all([
      supabase.from("vehicles").select("id, registration, type").eq("status", "active").order("registration"),
      supabase.from("tanks").select("id, name, fuel_type").order("name"),
      isModuleEnabled(supabase, appUser.organization_id, "ocr"),
      supabase.from("vehicles").select("id").eq("assigned_driver_id", appUser.id).eq("status", "active").maybeSingle(),
      params.driver ? supabase.from("users").select("full_name").eq("id", params.driver).maybeSingle() : Promise.resolve({ data: null }),
      // Secours téléphone en panne / urgence : la direction (et tout
      // manager) peut saisir un plein pour n'importe quel chauffeur,
      // sans badge à scanner — un menu déroulant plutôt que le scan
      // obligatoire. Les comptables ne créent jamais d'entrée (hors de
      // canCreate), donc pas de fetch pour eux.
      canCreate
        ? supabase.from("users").select("id, full_name").eq("active", true).in("role", ["chauffeur", "manager_chauffeur"]).order("full_name")
        : Promise.resolve({ data: null }),
    ]);

    return (
      <div className="mx-auto max-w-lg">
        <PageHeader
          title="Nouveau ravitaillement"
          description={hasRole(appUser.role, ["direction"]) ? "Plein à la cuve ou achat en station. La direction peut saisir un ravitaillement oublié à sa date réelle, même après coup ; les écarts de totaliseur restent signalés." : "Plein à la cuve de l'entreprise ou achat en station (ticket)."}
          actions={
            <Link href="/fuel" className="btn-secondary">
              ← Historique
            </Link>
          }
        />
        <NewFuelEntryWizard
          vehicles={vehicles ?? []}
          tanks={tanks ?? []}
          employees={employees ?? undefined}
          ocrEnabled={ocrEnabled}
          initialVehicleId={params.vehicle}
          initialTankId={params.tank}
          initialDriverId={params.driver}
          initialDriverName={driver?.full_name}
          assignedVehicleId={assignedVehicle?.id}
          selfDriverId={appUser.id}
          selfDriverName={appUser.full_name}
          selfIsDriver={selfIsDriver}
        />
      </div>
    );
  }

  // Historique paginé (50 par page) et filtrable par période — les
  // jours du filtre sont des jours de Paris.
  const page = Math.max(1, Math.floor(Number(params.page)) || 1);
  const from = params.from && DAY_RE.test(params.from) ? params.from : null;
  const to = params.to && DAY_RE.test(params.to) ? params.to : null;
  let query = supabase
    .from("fuel_entries")
    .select(
      "id, occurred_at, liters, unit_price, total_amount, status, gap_flagged, station_name, product, tank_id, vehicles(registration), users!fuel_entries_driver_id_fkey(full_name), tanks(name)",
      { count: "exact" },
    )
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (params.vehicle) query = query.eq("vehicle_id", params.vehicle);
  if (params.driver) query = query.eq("driver_id", params.driver);
  if (params.status) query = query.eq("status", params.status);
  if (from) query = query.gte("occurred_at", parisMidnightIso(from));
  if (to) query = query.lt("occurred_at", parisMidnightIso(nextDay(to)));

  const [{ data: entries, error, count }, { data: vehicles }, { data: drivers }] = await Promise.all([
    query,
    supabase.from("vehicles").select("id, registration").order("registration"),
    canSeeOtherDrivers ? supabase.from("users").select("id, full_name").eq("active", true).order("full_name") : Promise.resolve({ data: null }),
  ]);

  return (
    <div>
      <PageHeader
        title="Historique carburant"
        description="Tous les ravitaillements — filtrez par véhicule ou par chauffeur pour voir qui a eu quoi, quand."
        actions={
          canCreate ? (
            <Link href="/fuel?new=1" className="btn-primary">
              + Nouveau ravitaillement
            </Link>
          ) : undefined
        }
      />

      <FuelHistoryFilters
        vehicles={(vehicles ?? []).map((v) => ({ id: v.id, label: v.registration }))}
        drivers={canSeeOtherDrivers ? (drivers ?? []).map((d) => ({ id: d.id, label: d.full_name })) : null}
      />

      {error && <Card className="mb-4 text-orange-ink">{error.message}</Card>}

      <FuelHistoryTable entries={(entries ?? []) as any} />

      <FuelHistoryPager params={params} page={page} total={count ?? 0} />
    </div>
  );
}

/** Pagination de l'historique : liens précédent / suivant qui gardent les filtres. */
function FuelHistoryPager({ params, page, total }: { params: Record<string, string | undefined>; page: number; total: number }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages <= 1) return null;
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "page" && k !== "new") q.set(k, v);
    if (p > 1) q.set("page", String(p));
    const qs = q.toString();
    return qs ? `/fuel?${qs}` : "/fuel";
  };
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm">
      {page > 1 ? (
        <Link href={href(page - 1)} className="btn-secondary !px-3 !py-1.5">
          ← Plus récents
        </Link>
      ) : (
        <span />
      )}
      <span className="text-navy/60">
        Page {Math.min(page, pages)} / {pages} · {total} ravitaillement{total > 1 ? "s" : ""}
      </span>
      {page < pages ? (
        <Link href={href(page + 1)} className="btn-secondary !px-3 !py-1.5">
          Plus anciens →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

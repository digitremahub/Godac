import { garderPage } from "@/lib/acces/garde-page";
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { hasRole } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader, Card } from "@/components/ui";
import { FuelHistoryTable } from "@/components/fuel/FuelHistoryTable";
import { FuelHistoryFilters } from "@/components/fuel/FuelHistoryFilters";
import { NewFuelEntryWizard } from "@/components/fuel/NewFuelEntryWizard";
import { nextDay, parisMidnightIso } from "@/lib/utils/paris-time";
import { JaugesQuotas } from "@/components/acces/JaugesQuotas";
import { FILTRE_CONDUCTEURS } from "@/lib/roles/conducteurs";
import { chargerSuiviEcarts } from "@/lib/fuel/ecarts-serveur";
import { ecartsDuPlein, statutEcart } from "@/lib/fuel/ecarts";

const PAGE_SIZE = 50;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  searchParams: Promise<{ vehicle?: string; driver?: string; status?: string; tank?: string; new?: string; from?: string; to?: string; page?: string; plein?: string }>;
}) {
  const params = await searchParams;
  const g = await garderPage("carburant.pleins");
  if (!g.ok) return g.ecran;
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();
  const wizardMode = Boolean(params.new);
  const canSeeOtherDrivers = hasRole(appUser.role, ["manager", "direction", "comptable"]);
  const canCreate = hasRole(appUser.role, ["manager", "direction"]);
  // Un manager qui conduit est lui-même chauffeur — "soi-même" reste un
  // choix valide par défaut. Un manager/la direction ne le sont jamais :
  // les laisser sur ce défaut soumettrait le plein au nom de leur
  // propre compte (jamais un vrai chauffeur), d'où le champ vide forcé
  // ci-dessous pour ces deux rôles tant qu'un employé n'est pas choisi.
  const selfIsDriver = appUser.conduit;

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
        ? supabase.from("users").select("id, full_name").eq("active", true).or(FILTRE_CONDUCTEURS).order("full_name")
        : Promise.resolve({ data: null }),
    ]);

    return (
      <div className="mx-auto max-w-lg">
        <PageHeader
          title="Nouveau ravitaillement"
          description={hasRole(appUser.role, ["direction"]) ? "Plein à la cuve ou achat en station. La direction peut saisir un ravitaillement oublié à sa date réelle, même après coup ; les écarts de totaliseur restent signalés." : "Plein à la cuve de l'entreprise ou achat en station (ticket)."}
          actions={
            <Link href="/carburant/pleins" className="btn-secondary">
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
      "id, occurred_at, liters, unit_price, total_amount, status, gap_flagged, totalizer_gap, totalizer_before, totalizer_after, pmp_at_entry, ocr_raw, station_name, product, tank_id, vehicles(registration), users!fuel_entries_driver_id_fkey(full_name), tanks(name)",
      { count: "exact" },
    )
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  // Lien d'une alerte d'écart (?plein=) : ce plein seul, fiche ouverte.
  const pleinCible = params.plein && UUID_RE.test(params.plein) ? params.plein : null;
  if (pleinCible) query = query.eq("id", pleinCible);
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

  // Écarts de chaque plein et statut de leur traitement (journal
  // fuel_gap_reviews ; tolère la migration pas encore appliquée).
  const suivi = await chargerSuiviEcarts(supabase, (entries ?? []).map((e) => e.id));
  const lignes = (entries ?? []).map(({ ocr_raw, totalizer_before, totalizer_after, totalizer_gap, pmp_at_entry, ...e }) => ({
    ...e,
    statut_ecart: statutEcart(
      ecartsDuPlein({ ...e, ocr_raw, totalizer_before, totalizer_after, totalizer_gap, pmp_at_entry }, suivi.alertes.get(e.id) ?? []).length,
      suivi.traitements.get(e.id) ?? [],
    ),
  }));
  const aTraiter = lignes.filter((l) => l.statut_ecart === "ouvert" || l.statut_ecart === "reponse_recue").length;

  return (
    <div>
      <PageHeader
        title="Historique carburant"
        description="Tous les ravitaillements — filtrez par véhicule ou par chauffeur pour voir qui a eu quoi, quand."
        actions={
          canCreate ? (
            <Link href="/carburant/pleins?new=1" className="btn-primary">
              + Nouveau ravitaillement
            </Link>
          ) : undefined
        }
      />
      <JaugesQuotas organizationId={appUser.organization_id} role={appUser.role} fonctions={["ocr_ticket"]} />

      <FuelHistoryFilters
        vehicles={(vehicles ?? []).map((v) => ({ id: v.id, label: v.registration }))}
        drivers={canSeeOtherDrivers ? (drivers ?? []).map((d) => ({ id: d.id, label: d.full_name })) : null}
      />

      {error && <Card className="mb-4 text-orange-ink">{error.message}</Card>}

      {pleinCible && (
        <Card className="mb-4 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>Plein ouvert depuis une alerte d&apos;écart.</span>
          <Link href="/carburant/pleins" className="text-teal-ink underline">
            Voir tout l&apos;historique
          </Link>
        </Card>
      )}
      {!pleinCible && canCreate && aTraiter > 0 && (
        <p className="mb-3 text-sm text-orange-ink">
          {aTraiter} écart{aTraiter > 1 ? "s" : ""} à traiter sur cette page — ouvrez « Détails » pour justifier / classer ou demander une explication.
        </p>
      )}

      <FuelHistoryTable entries={lignes as any} initialOpenId={pleinCible ?? undefined} />

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
    return qs ? `/carburant/pleins?${qs}` : "/carburant/pleins";
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

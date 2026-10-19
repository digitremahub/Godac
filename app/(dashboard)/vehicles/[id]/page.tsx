import { garderPage } from "@/lib/acces/garde-page";
import { notFound } from "next/navigation";
import { libellePhoto } from "@/lib/tours/changement-vehicule";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { hasRole } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { QrCodeBadge } from "@/components/qr/QrCodeBadge";
import Link from "next/link";
import { InterventionsPanel } from "@/components/vehicles/InterventionsPanel";
import { VehicleEditPanel } from "@/components/vehicles/VehicleEditPanel";
import { RoleGate } from "@/components/layout/RoleGate";
import { FuelHistoryTable } from "@/components/fuel/FuelHistoryTable";
import { OdometerHistory, type OdometerReading } from "@/components/vehicles/OdometerHistory";
import { WashHistory, type WashRecord } from "@/components/vehicles/WashHistory";
import { getVehicleConsumption } from "@/lib/vehicles/consumption";
import { VehicleDocumentsPanel } from "@/components/vehicles/VehicleDocumentsPanel";
import { listVehicleDocuments } from "@/lib/vehicles/documents";
import { parisCalendarDate } from "@/lib/planning/dates";
import { getVehicleLatestKmReading } from "@/lib/vehicles/odometer-reference";
import { VehicleRentalPanel, type KmSummary } from "@/components/rental/VehicleRentalPanel";
import { RentalRequestsList } from "@/components/rental/RentalRequestsList";
import { loadRentalRequests } from "@/lib/rental/load-requests";
import { daysUntil, evaluateKmAllowance, formatKm, KM_LEVEL_LABELS } from "@/lib/rental/contract";

type SpecSources = Record<string, { origin: "ia" | "saisie" | "import"; confirmed: boolean } | undefined> | null;

/** Small provenance tag under a spec field — "Estimé par IA" until a human confirms or edits it (Lot A). */
function SpecProvenance({ field, specSources, label }: { field: string; specSources: SpecSources; label?: string }) {
  const source = specSources?.[field];
  if (!source || source.origin !== "ia") return null;
  return (
    <p className="text-xs text-gold-ink">
      {label ? `${label} : ` : ""}🤖 Estimé par IA{source.confirmed ? ", confirmé" : " — à vérifier"}
    </p>
  );
}

export default async function VehicleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderPage("flotte.vehicule_fiche");
  if (!g.ok) return g.ecran;
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();

  const [fleetEnabled, washesEnabled, rentalEnabled] = await Promise.all([
    isModuleEnabled(supabase, appUser.organization_id, "fleet"),
    isModuleEnabled(supabase, appUser.organization_id, "washes"),
    isModuleEnabled(supabase, appUser.organization_id, "rental_providers"),
  ]);
  if (!fleetEnabled) {
    return <EmptyState title="Module Flotte non activé" description="Activez-le depuis les paramètres de votre organisation." />;
  }

  const [
    { data: vehicle },
    { data: interventions },
    { data: services },
    { data: fuelHistory },
    { data: tours },
    { data: washes },
    consumption30d,
    consumption90d,
    { data: drivers },
  ] = await Promise.all([
      supabase
        .from("vehicles")
        .select(
          "id, registration, type, status, tank_capacity_liters, initial_km, created_at, service_id, services(name), assigned_driver_id, users!vehicles_assigned_driver_id_fkey(full_name), brand, model, model_year, gearbox, fuel_type, adblue_capacity_liters, ptac_kg, reference_consumption_l_100km, spec_sources, ownership, rental_provider_id, rental_contract_ref, rental_start_date, rental_end_date, rental_km_allowance, rental_start_km",
        )
        .eq("id", id)
        .single(),
      supabase
        .from("vehicle_interventions")
        .select(
          "id, type, description, urgency, status, scheduled_at, completed_at, cost, odometer_km, appointment_needed, photo_paths, created_at",
        )
        .eq("vehicle_id", id)
        .order("created_at", { ascending: false }),
      supabase.from("services").select("id, name").order("name"),
      supabase
        .from("fuel_entries")
        .select("id, occurred_at, liters, total_amount, status, gap_flagged, product, station_name, tank_id, tanks(name), users!fuel_entries_driver_id_fkey(full_name)")
        .eq("vehicle_id", id)
        .order("occurred_at", { ascending: false })
        .limit(15),
      supabase
        .from("planning_entries")
        .select("id, tour_number, start_at, end_at, start_km, end_km, status, services(name), users!planning_entries_driver_id_fkey(full_name)")
        .eq("vehicle_id", id)
        .in("status", ["in_progress", "done"])
        .order("start_at", { ascending: false })
        .limit(20),
      washesEnabled
        ? supabase
            .from("vehicle_washes")
            .select("id, created_at, washed_exterior, washed_cabin_interior, washed_trailer, users(full_name)")
            .eq("vehicle_id", id)
            .order("created_at", { ascending: false })
            .limit(20)
        : Promise.resolve({ data: null }),
      getVehicleConsumption(supabase, id, 30),
      getVehicleConsumption(supabase, id, 90),
      supabase.from("users").select("id, full_name").eq("active", true).in("role", ["chauffeur", "manager_chauffeur"]).order("full_name"),
    ]);
  const kmActuel = await getVehicleLatestKmReading(supabase, id);

  // Photos d'état prises à chaque changement de véhicule (10 derniers passages de main).
  const { data: photosEtat } = await supabase
    .from("vehicle_change_photos")
    .select("planning_entry_id, stage, kind, photo_path, created_at, users!vehicle_change_photos_driver_id_fkey(full_name), planning_entries(tour_number)")
    .eq("vehicle_id", id)
    .order("created_at", { ascending: false })
    .limit(60);
  const passages = Object.values(
    ((photosEtat ?? []) as any[]).reduce<Record<string, { cle: string; date: string; chauffeur: string; tournee: string | null; stage: string; photos: { kind: string; path: string }[] }>>(
      (acc, p) => {
        const cle = `${p.planning_entry_id}-${p.stage}`;
        acc[cle] ??= { cle, date: p.created_at, chauffeur: p.users?.full_name ?? "—", tournee: p.planning_entries?.tour_number ?? null, stage: p.stage, photos: [] };
        acc[cle].photos.push({ kind: p.kind, path: p.photo_path });
        return acc;
      },
      {},
    ),
  ).slice(0, 10);
  const passagesAvecUrls = await Promise.all(
    passages.map(async (pa) => ({
      ...pa,
      photos: await Promise.all(
        pa.photos.map(async (ph) => ({ ...ph, url: (await supabase.storage.from("tour-photos").createSignedUrl(ph.path, 600)).data?.signedUrl ?? null })),
      ),
    })),
  );

  if (!vehicle) notFound();
  const v = vehicle as any;

  const interventionsWithPhotos = await Promise.all(
    (interventions ?? []).map(async (i: any) => {
      const paths: string[] = i.photo_paths ?? [];
      const photoUrls = await Promise.all(
        paths.map(async (path) => {
          const { data } = await supabase.storage.from("intervention-photos").createSignedUrl(path, 600);
          return data?.signedUrl ?? null;
        }),
      );
      return { ...i, photoUrls: photoUrls.filter((u): u is string => Boolean(u)) };
    }),
  );

  const odometerReadings: OdometerReading[] = [
    ...(v.initial_km !== null ? [{ at: v.created_at, km: v.initial_km, label: "Kilométrage initial" }] : []),
    ...(tours ?? []).flatMap((t: any) => [
      ...(t.start_km !== null ? [{ at: t.start_at, km: t.start_km, label: `Départ tournée n°${t.tour_number}` }] : []),
      ...(t.end_km !== null && t.end_at ? [{ at: t.end_at, km: t.end_km, label: `Retour tournée n°${t.tour_number}` }] : []),
    ]),
    ...(interventions ?? [])
      .filter((i: any) => i.odometer_km !== null)
      .map((i: any) => ({ at: i.created_at, km: i.odometer_km, label: `Intervention : ${i.type}` })),
  ];

  // Module « Véhicules loués » : contrat, forfait km au prorata, demandes au loueur.
  const canManageRental = rentalEnabled && hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"]);
  const today = parisCalendarDate(new Date().toISOString());
  const [rentalProviders, rentalRequests, linkedRequests] = canManageRental
    ? await Promise.all([
        supabase.from("rental_providers").select("id, name, active").order("name").then((r) => (r.data ?? []) as { id: string; name: string; active: boolean }[]),
        loadRentalRequests(supabase, { vehicleId: id }, 50),
        supabase.from("rental_maintenance_requests").select("intervention_id").eq("vehicle_id", id).then((r) => (r.data ?? []) as { intervention_id: string }[]),
      ])
    : [[], [], []];
  const rentalProviderName = rentalProviders.find((p) => p.id === v.rental_provider_id)?.name ?? null;
  const kmEval =
    v.rental_km_allowance && v.rental_start_date && v.rental_end_date && v.rental_start_km != null && kmActuel
      ? evaluateKmAllowance({
          allowanceKm: Number(v.rental_km_allowance),
          startDate: v.rental_start_date,
          endDate: v.rental_end_date,
          startKm: Number(v.rental_start_km),
          currentKm: kmActuel.km,
          today,
        })
      : null;
  const kmSummary: KmSummary | null = kmEval
    ? { level: kmEval.level, levelLabel: KM_LEVEL_LABELS[kmEval.level], drivenKm: formatKm(kmEval.drivenKm), prorataKm: formatKm(kmEval.prorataKm), projectedKm: formatKm(kmEval.projectedKm) }
    : null;
  const requestedInterventionIds = new Set(linkedRequests.map((l) => l.intervention_id));
  const orphanInterventions = ((interventions ?? []) as any[])
    .filter((i) => (i.status === "scheduled" || i.status === "in_progress") && !requestedInterventionIds.has(i.id))
    .map((i) => ({ id: i.id as string, type: i.type as string, created_at: i.created_at as string }));

  const canManageDocuments = hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"]);
  const vehicleDocuments = canManageDocuments ? await listVehicleDocuments(supabase, id) : [];

  return (
    <div>
      <PageHeader
        title={v.registration}
        description={`${v.type} · ${v.services?.name ?? "Sans service"}`}
        actions={
          <RoleGate role={appUser.role} allow={["manager", "manager_chauffeur", "direction"]}>
            <VehicleEditPanel
              vehicleId={v.id}
              registration={v.registration}
              type={v.type}
              tankCapacity={v.tank_capacity_liters}
              initialKm={v.initial_km}
              status={v.status}
              serviceId={v.service_id}
              services={services ?? []}
              assignedDriverId={v.assigned_driver_id}
              drivers={drivers ?? []}
              brand={v.brand}
              model={v.model}
              modelYear={v.model_year}
              gearbox={v.gearbox}
              fuelType={v.fuel_type}
              adblueCapacity={v.adblue_capacity_liters}
              ptac={v.ptac_kg}
              referenceConsumption={v.reference_consumption_l_100km}
              specSources={v.spec_sources ?? {}}
            />
          </RoleGate>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {canManageDocuments && (
            <VehicleDocumentsPanel vehicleId={id} documents={vehicleDocuments} today={parisCalendarDate(new Date().toISOString())} />
          )}

          {canManageRental && v.ownership !== "propre" && (
            <div>
              <h3 className="mb-2 text-base">Demandes au loueur{rentalProviderName ? ` (${rentalProviderName})` : ""}</h3>
              <RentalRequestsList requests={rentalRequests} showVehicle={false} />
            </div>
          )}

          <InterventionsPanel
            vehicleId={id}
            interventions={interventionsWithPhotos}
            canManage={hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"])}
          />

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-base">Historique des chauffeurs</h3>
              <Link href={`/fuel?vehicle=${id}`} className="text-sm text-teal-ink hover:underline">
                Voir tout l&apos;historique →
              </Link>
            </div>
            <FuelHistoryTable
              entries={(fuelHistory ?? []) as any}
              showVehicle={false}
              emptyDescription="Aucun ravitaillement enregistré pour ce véhicule."
            />
          </div>

          <div>
            <h3 className="mb-2 text-base">Historique de conduite</h3>
            {!tours || tours.length === 0 ? (
              <EmptyState title="Aucune tournée" description="Qui a conduit ce véhicule et quand apparaîtra ici." />
            ) : (
              <Card className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="text-left text-navy/60">
                    <tr>
                      <th className="pb-2">Date</th>
                      <th className="pb-2">Chauffeur</th>
                      <th className="pb-2">Service</th>
                      <th className="pb-2">Tournée</th>
                      <th className="pb-2">Horaires</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(tours as any[]).map((t) => (
                      <tr key={t.id} className="border-t border-navy/5">
                        <td className="py-2">
                          {new Date(t.start_at).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "short", year: "numeric" })}
                        </td>
                        <td className="py-2">{t.users?.full_name ?? "—"}</td>
                        <td className="py-2">{t.services?.name ?? "—"}</td>
                        <td className="py-2">n°{t.tour_number}</td>
                        <td className="py-2">
                          {new Date(t.start_at).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" })}
                          {t.end_at
                            ? ` → ${new Date(t.end_at).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" })}`
                            : " → en cours"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </div>

          {washesEnabled && (
            <WashHistory
              washes={(washes ?? []).map((w: any) => ({
                id: w.id,
                created_at: w.created_at,
                washed_exterior: w.washed_exterior,
                washed_cabin_interior: w.washed_cabin_interior,
                washed_trailer: w.washed_trailer,
                driverName: w.users?.full_name ?? "—",
              })) as WashRecord[]}
            />
          )}
        </div>
        <div className="flex flex-col items-center gap-4">
          <Card className="w-full border-teal/40">
            <p className="text-sm text-navy/65">Kilométrage actuel</p>
            {kmActuel ? (
              <>
                <p className="font-display text-2xl font-bold tabular-nums">{Math.round(kmActuel.km).toLocaleString("fr-FR").replace(/[\u202f\u00a0]/g, " ")} km</p>
                <p className="text-xs text-navy/60">
                  Dernier relevé le{" "}
                  {new Date(kmActuel.at).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "short", year: "numeric" })} ·{" "}
                  {kmActuel.source}
                </p>
              </>
            ) : (
              <p className="text-sm text-navy/60">Aucun relevé : il s&apos;affichera au premier départ de tournée ou au premier plein.</p>
            )}
          </Card>
          {canManageRental && (
            <VehicleRentalPanel
              vehicleId={v.id}
              info={{
                ownership: v.ownership ?? "propre",
                rental_provider_id: v.rental_provider_id,
                rental_contract_ref: v.rental_contract_ref,
                rental_start_date: v.rental_start_date,
                rental_end_date: v.rental_end_date,
                rental_km_allowance: v.rental_km_allowance,
                rental_start_km: v.rental_start_km != null ? Number(v.rental_start_km) : null,
              }}
              providerName={rentalProviderName}
              providers={rentalProviders.filter((p) => p.active || p.id === v.rental_provider_id)}
              canEdit
              daysLeft={v.rental_end_date ? daysUntil(v.rental_end_date, today) : null}
              km={kmSummary}
              orphanInterventions={orphanInterventions}
            />
          )}
          {(v.brand || v.model) && (
            <Card className="w-full">
              <p className="text-sm text-navy/65">Modèle</p>
              <p className="text-lg">
                {[v.brand, v.model].filter(Boolean).join(" ")}
                {v.model_year ? ` (${v.model_year})` : ""}
              </p>
              {v.gearbox && <p className="text-xs text-navy/60">Boîte {v.gearbox}</p>}
            </Card>
          )}
          <Card>
            <p className="text-sm text-navy/65">Capacité réservoir</p>
            <p className="text-xl">{v.tank_capacity_liters ? `${v.tank_capacity_liters} L` : "Non renseignée"}</p>
            <SpecProvenance field="tank_capacity_liters" specSources={v.spec_sources} />
          </Card>
          <Card className="w-full">
            <p className="mb-2 text-sm text-navy/65">Caractéristiques techniques</p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-navy/60">Carburant</p>
                <p>{v.fuel_type ?? "—"}</p>
                <SpecProvenance field="fuel_type" specSources={v.spec_sources} />
              </div>
              <div>
                <p className="text-navy/60">AdBlue</p>
                <p>{v.adblue_capacity_liters ? `${v.adblue_capacity_liters} L` : "—"}</p>
                <SpecProvenance field="adblue_capacity_liters" specSources={v.spec_sources} />
              </div>
              <div>
                <p className="text-navy/60">PTAC</p>
                <p>{v.ptac_kg ? `${v.ptac_kg} kg` : "—"}</p>
                <SpecProvenance field="ptac_kg" specSources={v.spec_sources} />
              </div>
              <div>
                <p className="text-navy/60">Conso. référence</p>
                <p>{v.reference_consumption_l_100km ? `${v.reference_consumption_l_100km} L/100km` : "—"}</p>
                <SpecProvenance field="reference_consumption_l_100km" specSources={v.spec_sources} />
              </div>
            </div>
            <SpecProvenance field="type" specSources={v.spec_sources} label="Type" />
          </Card>
          <Card>
            <p className="text-sm text-navy/65">Chauffeur assigné</p>
            <p className="text-xl">{v.users?.full_name ?? "Aucun"}</p>
          </Card>
          <Card className="w-full">
            <p className="mb-2 text-sm text-navy/65">Consommation moyenne</p>
            <div className="flex justify-around text-center">
              <div>
                <p className="text-xl">{consumption30d !== null ? `${consumption30d} L/100km` : "—"}</p>
                <p className="text-xs text-navy/60">30 derniers jours</p>
              </div>
              <div>
                <p className="text-xl">{consumption90d !== null ? `${consumption90d} L/100km` : "—"}</p>
                <p className="text-xs text-navy/60">90 derniers jours</p>
              </div>
            </div>
            {consumption30d === null && consumption90d === null && (
              <p className="mt-2 text-xs text-navy/60">Pas assez de relevés kilométriques pour calculer la consommation.</p>
            )}
          </Card>
          <div className="w-full">
            <OdometerHistory readings={odometerReadings} />
          </div>
          <Card className="w-full">
            <p className="text-sm text-navy/65">Photos d&apos;état aux changements de véhicule</p>
            {passagesAvecUrls.length === 0 ? (
              <p className="mt-2 text-xs text-navy/60">
                Aucune pour l&apos;instant. À chaque changement de véhicule (hors dépannage), le chauffeur qui le récupère photographie
                l&apos;habitacle, le tableau de bord et le tour du véhicule.
              </p>
            ) : (
              <div className="mt-2 flex flex-col gap-3">
                {passagesAvecUrls.map((pa) => (
                  <div key={pa.cle}>
                    <p className="text-xs text-navy/70">
                      <span className="font-semibold text-navy">{pa.chauffeur}</span> ·{" "}
                      {new Date(pa.date).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" })} ·{" "}
                      {pa.stage === "depart" ? "pris au départ" : "pris en cours de tournée"}
                      {pa.tournee ? ` · tournée n°${pa.tournee}` : ""}
                    </p>
                    <div className="mt-1 grid grid-cols-3 gap-1 sm:grid-cols-6">
                      {pa.photos.map((ph) =>
                        ph.url ? (
                          <a key={ph.path} href={ph.url} target="_blank" rel="noreferrer" className="group relative block aspect-square overflow-hidden rounded-md bg-navy/5">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={ph.url} alt={libellePhoto(ph.kind)} className="h-full w-full object-cover" />
                            <span className="absolute inset-x-0 bottom-0 bg-navy/70 px-1 text-[10px] text-white">{libellePhoto(ph.kind)}</span>
                          </a>
                        ) : null,
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <QrCodeBadge
            type="vehicle"
            id={v.id}
            title={v.registration}
            subtitle="À coller sur le tableau de bord"
          />
        </div>
      </div>
    </div>
  );
}

import { requireAppUser, hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { QrCodeBadge } from "@/components/qr/QrCodeBadge";
import { TankPhotoCapture } from "@/components/tanks/TankPhotoCapture";
import { TankEditPanel } from "@/components/tanks/TankEditPanel";
import { AddTankForm } from "@/components/tanks/AddTankForm";
import { TankDeliveryForm } from "@/components/tanks/TankDeliveryForm";
import { TankPhotosTable } from "@/components/tanks/TankPhotosTable";
import { TankDeliveriesTable } from "@/components/tanks/TankDeliveriesTable";
import { TanksPageTabs } from "@/components/tanks/TanksPageTabs";

/** "Cuves" et "Approvisionnements" (ex-/tanks/deliveries) réunis sur une seule page à onglets — une création d'approvisionnement vivait déjà sur l'onglet Cuves (TankDeliveryForm par cuve), l'ancien /tanks/deliveries n'était qu'un historique en lecture seule. */
export default async function TanksPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const params = await searchParams;
  const tab = params.tab === "approvisionnements" ? "approvisionnements" : "cuves";
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  const canManage = hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"]);

  return (
    <div>
      <PageHeader
        title="Cuves & Approvisionnements"
        description="Index totaliseur en temps réel et livraisons de carburant dans les cuves."
      />
      <TanksPageTabs tab={tab} />

      {tab === "cuves" ? (
        <TanksTab canManage={canManage} />
      ) : (
        <DeliveriesTab supabase={supabase} canManage={canManage} />
      )}
    </div>
  );
}

async function TanksTab({ canManage }: { canManage: boolean }) {
  const supabase = await createServerSupabaseClient();

  const [{ data: tanks }, { data: services }, { data: photos }] = await Promise.all([
    supabase
      .from("tanks")
      .select(
        "id, name, fuel_type, capacity_liters, current_totalizer_index, current_stock_liters, last_reading_at, service_id, services(name)",
      )
      .order("name"),
    supabase.from("services").select("id, name").order("name"),
    supabase
      .from("tank_photos")
      .select("id, totalizer_reading, note, status, created_at, photo_path, tanks(name), users!tank_photos_submitted_by_fkey(full_name)")
      .order("created_at", { ascending: false }),
  ]);

  const photoRows = (photos ?? []) as any[];
  const photosWithUrls = await Promise.all(
    photoRows.map(async (p) => {
      const { data } = await supabase.storage.from("tank-photos").createSignedUrl(p.photo_path, 600);
      return {
        id: p.id,
        tankName: p.tanks?.name ?? "—",
        submittedByName: p.users?.full_name ?? "—",
        totalizerReading: p.totalizer_reading,
        note: p.note,
        status: p.status,
        createdAt: p.created_at,
        photoUrl: data?.signedUrl ?? null,
      };
    }),
  );

  return (
    <>
      {canManage && <AddTankForm services={services ?? []} />}

      {!tanks || tanks.length === 0 ? (
        <EmptyState
          title="Aucune cuve configurée"
          description={canManage ? "Ajoutez votre première cuve ci-dessus." : "Demandez à votre manager ou direction d'ajouter une cuve."}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tanks.map((tank: any) => (
            <Card key={tank.id} className="flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg">{tank.name}</h3>
                  <p className="text-sm text-navy/65">{tank.services?.name ?? "Sans service"}</p>
                </div>
                <span className={tank.fuel_type === "diesel" ? "badge-teal" : "badge-gold"}>
                  {tank.fuel_type === "diesel" ? "Diesel" : "AdBlue"}
                </span>
              </div>

              <div>
                <p className="text-sm text-navy/65">Index totaliseur courant</p>
                <p className="font-display text-2xl font-extrabold text-teal-ink">
                  {tank.current_totalizer_index?.toLocaleString("fr-FR")} L
                </p>
              </div>

              <div>
                <div className="flex justify-between text-sm text-navy/65">
                  <span>Stock estimé</span>
                  <span>{tank.capacity_liters?.toLocaleString("fr-FR")} L capacité</span>
                </div>
                <p className={`font-display text-xl font-extrabold ${tank.current_stock_liters < 0 ? "text-orange-ink" : "text-gold-ink"}`}>
                  {tank.current_stock_liters?.toLocaleString("fr-FR")} L
                </p>
                {tank.current_stock_liters < 0 && (
                  <p className="text-xs text-orange-ink">Négatif = approvisionnements manquants dans l&apos;historique.</p>
                )}
              </div>

              <div className="flex justify-between text-sm text-navy/65">
                <span>
                  {tank.last_reading_at
                    ? `Dernier plein: ${new Date(tank.last_reading_at).toLocaleDateString("fr-FR")}`
                    : "Aucun plein enregistré"}
                </span>
              </div>

              <QrCodeBadge type="tank" id={tank.id} title={tank.name} subtitle="À coller sur la pompe" />
              <TankPhotoCapture tankId={tank.id} />
              {canManage && <TankDeliveryForm tankId={tank.id} />}
              {canManage && (
                <TankEditPanel
                  tankId={tank.id}
                  name={tank.name}
                  fuelType={tank.fuel_type}
                  capacityLiters={tank.capacity_liters}
                  serviceId={tank.service_id}
                  services={services ?? []}
                />
              )}
            </Card>
          ))}
        </div>
      )}

      <Card className="mt-6 text-sm text-navy/65">
        Le <b>stock estimé</b> augmente à chaque approvisionnement enregistré
        et diminue à chaque ravitaillement validé — c&apos;est une estimation
        qui part de 0 tant qu&apos;aucun approvisionnement initial n&apos;a été
        saisi. L&apos;<b>index totaliseur</b> (cumul dispensé, jamais remis à
        zéro) reste indépendant et demeure la donnée fiable utilisée pour la
        détection d&apos;écarts.
      </Card>

      <h3 className="mb-2 mt-6 text-base">Photos de cuves</h3>
      <TankPhotosTable photos={photosWithUrls} canReview={canManage} />
    </>
  );
}

async function DeliveriesTab({
  supabase,
  canManage,
}: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  canManage: boolean;
}) {
  const { data: deliveries } = await supabase
    .from("tank_deliveries")
    .select("id, liters, unit_price, supplier, delivered_at, invoice_path, tanks(name)")
    .order("delivered_at", { ascending: false });

  const rows = (deliveries ?? []) as any[];
  const withUrls = await Promise.all(
    rows.map(async (d) => {
      const invoiceUrl = d.invoice_path
        ? (await supabase.storage.from("tank-invoices").createSignedUrl(d.invoice_path, 600)).data?.signedUrl ?? null
        : null;
      return {
        id: d.id,
        tankName: d.tanks?.name ?? "—",
        liters: d.liters,
        unitPrice: d.unit_price,
        supplier: d.supplier,
        deliveredAt: d.delivered_at,
        invoiceUrl,
      };
    }),
  );

  return <TankDeliveriesTable deliveries={withUrls} canManage={canManage} />;
}

import { requireAppUser, hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { QrCodeBadge } from "@/components/qr/QrCodeBadge";
import { TankPhotoCapture } from "@/components/tanks/TankPhotoCapture";
import { TankEditPanel } from "@/components/tanks/TankEditPanel";
import { AddTankForm } from "@/components/tanks/AddTankForm";
import { TankDeliveryForm } from "@/components/tanks/TankDeliveryForm";

export default async function TanksPage() {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  const canManage = hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"]);

  const [{ data: tanks }, { data: services }] = await Promise.all([
    supabase
      .from("tanks")
      .select(
        "id, name, fuel_type, capacity_liters, current_totalizer_index, current_stock_liters, last_reading_at, service_id, services(name)",
      )
      .order("name"),
    supabase.from("services").select("id, name").order("name"),
  ]);

  return (
    <div>
      <PageHeader
        title="Cuves"
        description="Index totaliseur en temps réel — la source de vérité pour la détection d'écarts."
      />

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
                  <p className="text-sm text-navy/50">{tank.services?.name ?? "Sans service"}</p>
                </div>
                <span className={tank.fuel_type === "diesel" ? "badge-teal" : "badge-gold"}>
                  {tank.fuel_type === "diesel" ? "Diesel" : "AdBlue"}
                </span>
              </div>

              <div>
                <p className="text-sm text-navy/50">Index totaliseur courant</p>
                <p className="font-display text-2xl font-extrabold text-teal-ink">
                  {tank.current_totalizer_index?.toLocaleString("fr-FR")} L
                </p>
              </div>

              <div>
                <div className="flex justify-between text-sm text-navy/50">
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

              <div className="flex justify-between text-sm text-navy/50">
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

      <Card className="mt-6 text-sm text-navy/50">
        Le <b>stock estimé</b> augmente à chaque approvisionnement enregistré
        et diminue à chaque ravitaillement validé — c&apos;est une estimation
        qui part de 0 tant qu&apos;aucun approvisionnement initial n&apos;a été
        saisi. L&apos;<b>index totaliseur</b> (cumul dispensé, jamais remis à
        zéro) reste indépendant et demeure la donnée fiable utilisée pour la
        détection d&apos;écarts.
      </Card>
    </div>
  );
}

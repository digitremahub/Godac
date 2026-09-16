import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { QrCodeBadge } from "@/components/qr/QrCodeBadge";
import { TankPhotoCapture } from "@/components/tanks/TankPhotoCapture";

export default async function TanksPage() {
  const supabase = await createServerSupabaseClient();
  const { data: tanks } = await supabase
    .from("tanks")
    .select("id, name, fuel_type, capacity_liters, current_totalizer_index, last_reading_at, services(name)")
    .order("name");

  return (
    <div>
      <PageHeader
        title="Cuves"
        description="Index totaliseur en temps réel — la source de vérité pour la détection d'écarts."
      />

      {!tanks || tanks.length === 0 ? (
        <EmptyState title="Aucune cuve configurée" description="Ajoutez vos cuves depuis l'onboarding ou l'administration." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tanks.map((tank: any) => (
            <Card key={tank.id} className="flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg">{tank.name}</h3>
                  <p className="text-sm text-white/50">{tank.services?.name ?? "Sans service"}</p>
                </div>
                <span className={tank.fuel_type === "diesel" ? "badge-teal" : "badge-gold"}>
                  {tank.fuel_type === "diesel" ? "Diesel" : "AdBlue"}
                </span>
              </div>

              <div>
                <p className="text-sm text-white/50">Index totaliseur courant</p>
                <p className="font-display text-2xl font-extrabold text-teal">
                  {tank.current_totalizer_index?.toLocaleString("fr-FR")} L
                </p>
              </div>

              <div className="flex justify-between text-sm text-white/50">
                <span>Capacité: {tank.capacity_liters?.toLocaleString("fr-FR")} L</span>
                <span>
                  {tank.last_reading_at
                    ? `Dernier plein: ${new Date(tank.last_reading_at).toLocaleDateString("fr-FR")}`
                    : "Aucun plein enregistré"}
                </span>
              </div>

              <QrCodeBadge type="tank" id={tank.id} title={tank.name} subtitle="À coller sur la pompe" />
              <TankPhotoCapture tankId={tank.id} />
            </Card>
          ))}
        </div>
      )}

      <Card className="mt-6 text-sm text-white/50">
        Le niveau réel de carburant restant (litres physiquement dans la cuve)
        nécessite de suivre les livraisons de carburant, qui ne sont pas
        encore enregistrées dans GODAC — c&apos;est prévu en Phase 2. En
        attendant, l&apos;index totaliseur ci-dessus (cumul dispensé) reste la
        donnée fiable utilisée pour la détection d&apos;écarts.
      </Card>
    </div>
  );
}

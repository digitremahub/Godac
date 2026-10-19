import { garderPage } from "@/lib/acces/garde-page";
import { JaugeQuota } from "@/components/acces/JaugeQuota";
import { EtatAcces } from "@/components/acces/EtatAcces";
import { limiteVehicules } from "@/lib/acces/limites-serveur";
import { PageHeader } from "@/components/ui";
import { NewVehicleForm } from "@/components/vehicles/NewVehicleForm";

export default async function NewVehiclePage() {
  const g = await garderPage("flotte.vehicule_nouveau");
  if (!g.ok) return g.ecran;
  const { appUser, supabase } = g;
  const [{ data: services }, limite] = await Promise.all([
    supabase.from("services").select("id, name").order("name"),
    limiteVehicules(appUser.organization_id),
  ]);
  const direction = appUser.role === "direction";
  // Q8 : au-delà de 110 % des véhicules inclus, l'ajout est bloqué (l'API refuse aussi).
  if (limite.niveau === "bloque" && limite.inclus !== null) {
    return (
      <div>
        <PageHeader title="Ajouter un véhicule" />
        <EtatAcces motif="limite" utilise={limite.utilise} inclus={limite.inclus} unite="véhicules" formule={limite.nomFormule ?? undefined} direction={direction} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Ajouter un véhicule" />
      {limite.inclus !== null && (
        <div className="mb-4 max-w-md">
          <JaugeQuota libelle="Véhicules inclus dans votre formule" utilise={limite.utilise} inclus={limite.inclus} direction={direction} />
        </div>
      )}
      <NewVehicleForm services={services ?? []} />
    </div>
  );
}

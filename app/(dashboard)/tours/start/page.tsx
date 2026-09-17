import { requireAppUser } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui";
import { StartTourFlow } from "@/components/tours/StartTourFlow";

export default async function StartTourPage() {
  await requireAppUser();
  return (
    <div>
      <PageHeader
        title="Démarrer une tournée"
        description="Scannez le véhicule, indiquez le numéro de tournée et le kilométrage, puis prenez en photo la feuille de départ."
      />
      <div className="mx-auto max-w-md">
        <StartTourFlow />
      </div>
    </div>
  );
}

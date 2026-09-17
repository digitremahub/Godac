import { requireAppUser } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui";
import { EndTourFlow } from "@/components/tours/EndTourFlow";

export default async function EndTourPage() {
  await requireAppUser();
  return (
    <div>
      <PageHeader
        title="Terminer une tournée"
        description="Scannez le même véhicule, indiquez le kilométrage retour et les anomalies éventuelles, puis prenez en photo le rapport."
      />
      <div className="mx-auto max-w-md">
        <EndTourFlow />
      </div>
    </div>
  );
}

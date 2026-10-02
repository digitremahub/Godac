import { requireAppUser } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui";
import { EndTourFlow } from "@/components/tours/EndTourFlow";

export default async function EndTourPage({
  searchParams,
}: {
  searchParams: Promise<{ vehicle?: string }>;
}) {
  await requireAppUser();
  const { vehicle } = await searchParams;
  return (
    <div>
      <PageHeader
        title="Terminer une tournée"
        description="Scannez le même véhicule, indiquez le kilométrage retour et les anomalies éventuelles, puis prenez en photo le rapport."
      />
      <div className="mx-auto max-w-md">
        <EndTourFlow initialVehicleId={vehicle} />
      </div>
    </div>
  );
}

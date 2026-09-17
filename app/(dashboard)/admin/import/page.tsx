import { redirect } from "next/navigation";
import { requireAppUser } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui";
import { BulkImportPanel } from "@/components/admin/BulkImportPanel";

export default async function AdminImportPage() {
  const appUser = await requireAppUser();
  if (appUser.role !== "direction") {
    redirect("/dashboard");
  }

  return (
    <div>
      <PageHeader
        title="Import en masse"
        description="Ajoutez plusieurs véhicules et chauffeurs d'un coup depuis un fichier CSV, au lieu de les saisir un par un."
      />
      <BulkImportPanel />
    </div>
  );
}

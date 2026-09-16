import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { AlertList } from "@/components/alerts/AlertList";

export default async function AlertsPage() {
  const supabase = createServerSupabaseClient();
  const { data: alerts } = await supabase
    .from("alerts")
    .select("id, type, severity, message, status, notified_at, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div>
      <PageHeader
        title="Centre d'alertes"
        description="Écarts de totaliseur, anomalies de prix, échecs OCR — centralisés ici et par email."
      />
      <AlertList alerts={alerts ?? []} />
    </div>
  );
}

import { garderPage } from "@/lib/acces/garde-page";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { TicpeExportLinesReview } from "@/components/ticpe/TicpeExportLinesReview";

/**
 * Per-vehicle detail of one TICPE export — exploitation/comptable
 * ticks each line off as correct or corrects it, which regenerates
 * the downloadable PDF in place (see app/api/ticpe/export-lines/[id]).
 */
export default async function TicpeExportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderPage("carburant.ticpe_detail");
  if (!g.ok) return g.ecran;
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();


  const [{ data: exportRow }, { data: lines }] = await Promise.all([
    supabase.from("ticpe_exports").select("id, period_start, period_end, vehicle_count, total_liters, pdf_file_path").eq("id", id).maybeSingle(),
    supabase
      .from("ticpe_export_lines")
      .select("id, registration, vehicle_type, entry_count, computed_total_liters, computed_total_amount, corrected_total_liters, corrected_total_amount, status")
      .eq("export_id", id)
      .order("registration"),
  ]);
  if (!exportRow) notFound();

  return (
    <div>
      <PageHeader
        title={`Export TICPE — ${exportRow.period_start} → ${exportRow.period_end}`}
        description="Vérifiez chaque véhicule : confirmez s'il est correct, ou corrigez s'il ne l'est pas. Le PDF téléchargeable est régénéré à chaque action."
        actions={
          <div className="flex gap-2">
            <a href={`/api/ticpe/exports/${exportRow.id}/download`} className="btn-secondary !px-3 !py-1.5 text-sm">
              Télécharger (Excel)
            </a>
            {exportRow.pdf_file_path && (
              <a href={`/api/ticpe/exports/${exportRow.id}/download-pdf`} className="btn-primary !px-3 !py-1.5 text-sm">
                Télécharger (PDF)
              </a>
            )}
          </div>
        }
      />

      <Link href="/carburant/ticpe" className="mb-4 inline-block text-sm text-teal-ink hover:underline">
        ← Retour aux exports
      </Link>

      {!lines || lines.length === 0 ? (
        <EmptyState title="Aucune ligne" description="Aucun véhicule éligible sur cette période." />
      ) : (
        <Card className="overflow-x-auto">
          <TicpeExportLinesReview lines={lines as any} />
        </Card>
      )}
    </div>
  );
}

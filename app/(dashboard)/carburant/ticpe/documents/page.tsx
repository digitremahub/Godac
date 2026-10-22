import { garderPage } from "@/lib/acces/garde-page";
import Link from "next/link";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { AvertissementTicpe } from "@/components/ticpe/AvertissementTicpe";
import { GenerateurDocuments } from "@/components/ticpe/GenerateurDocuments";
import { chargerParametresTicpe } from "@/lib/ticpe/serveur";
import { periodeDemandee } from "@/lib/ticpe/periode-serveur";
import { formatJour } from "@/lib/ticpe/bareme";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { parisDay } from "@/lib/utils/paris-time";

const TYPES: Record<string, string> = { periode: "Récapitulatif 3310-TIC", era: "ERA annuel", dossier: "Dossier de contrôle (ZIP)" };

/**
 * Documents TICPE : récapitulatif 3310-TIC d'une période (évolution de
 * l'export historique, vérifiable ligne par ligne), état récapitulatif
 * annuel (ERA), dossier de contrôle ZIP ; liste des documents générés.
 */
export default async function DocumentsTicpePage({ searchParams }: { searchParams: Promise<{ periode?: string; du?: string; au?: string }> }) {
  const g = await garderPage("carburant.ticpe_documents");
  if (!g.ok) return g.ecran;
  const { appUser, supabase } = g;
  const params = await searchParams;
  const aujourdhui = parisDay();
  const p = await chargerParametresTicpe(supabase, appUser.organization_id);
  const periode = periodeDemandee(params, p.reglages, aujourdhui);
  const annee = Number(aujourdhui.slice(0, 4));
  const annees = Array.from({ length: Math.max(1, annee - 2025 + 1) }, (_, i) => annee - i).filter((a) => a >= 2025);
  const anneeEra = aujourdhui.slice(5, 7) === "01" && annee - 1 >= 2025 ? annee - 1 : annee;

  const colonnes = "id, period_start, period_end, vehicle_count, total_liters, created_at, pdf_file_path";
  const lire = (c: string) => supabase.from("ticpe_exports").select(c).order("created_at", { ascending: false }).limit(200);
  let { data: exports, error } = await lire(`${colonnes}, document_type, total_refund`);
  if (error && estSchemaManquant(error)) ({ data: exports, error } = await lire(colonnes));

  return (
    <div>
      <PageHeader
        title="Documents TICPE"
        description="Récapitulatif à reporter sur l'annexe 3310-TIC de votre déclaration de TVA, état récapitulatif annuel (ERA) et dossier de contrôle. Les justificatifs se conservent, ils ne se joignent pas à la déclaration."
      />
      <AvertissementTicpe migrationManquante={p.migrationManquante} />
      <GenerateurDocuments debut={periode.debut} fin={periode.fin} libelle={periode.libelle} anneeEra={anneeEra} annees={annees} />

      {error && <Card className="mb-4 text-orange-ink">{error.message}</Card>}
      {!exports || exports.length === 0 ? (
        <EmptyState title="Aucun document généré" />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-navy/60">
              <tr>
                <th className="pb-2">Généré le</th>
                <th className="pb-2">Document</th>
                <th className="pb-2">Période</th>
                <th className="pb-2 text-right">Véhicules</th>
                <th className="pb-2 text-right">Litres</th>
                <th className="pb-2 text-right">Remboursement</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {(exports as any[]).map((exp) => {
                const type = exp.document_type ?? "periode";
                return (
                  <tr key={exp.id} className="border-t border-navy/5">
                    <td className="py-2">{new Date(exp.created_at).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}</td>
                    <td className="py-2">{TYPES[type] ?? type}</td>
                    <td className="py-2">
                      {formatJour(exp.period_start)} → {formatJour(exp.period_end)}
                    </td>
                    <td className="py-2 text-right tabular-nums">{exp.vehicle_count}</td>
                    <td className="py-2 text-right tabular-nums">{Number(exp.total_liters).toLocaleString("fr-FR")} L</td>
                    <td className="py-2 text-right tabular-nums">
                      {exp.total_refund === null || exp.total_refund === undefined ? "—" : Number(exp.total_refund).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}
                    </td>
                    <td className="py-2">
                      <div className="flex justify-end gap-3">
                        {type === "periode" && (
                          <Link href={`/carburant/ticpe/${exp.id}`} className="text-teal-ink hover:underline">
                            Vérifier
                          </Link>
                        )}
                        <a href={`/api/ticpe/exports/${exp.id}/download`} className="text-teal-ink hover:underline">
                          {type === "dossier" ? "ZIP" : "Excel"}
                        </a>
                        {exp.pdf_file_path && (
                          <a href={`/api/ticpe/exports/${exp.id}/download-pdf`} className="text-teal-ink hover:underline">
                            PDF
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

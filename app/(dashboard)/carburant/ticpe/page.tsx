import { garderPage } from "@/lib/acces/garde-page";
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { TicpeExportForm } from "@/components/ticpe/TicpeExportForm";
import { IconSparkles } from "@/components/layout/icons";

export default async function TicpePage() {
  const g = await garderPage("carburant.ticpe");
  if (!g.ok) return g.ecran;
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();


  const [{ data: exports }, { data: eligibleVehicles }] = await Promise.all([
    supabase
      .from("ticpe_exports")
      .select("id, period_start, period_end, vehicle_count, total_liters, created_at, pdf_file_path")
      .order("created_at", { ascending: false }),
    supabase.from("vehicles").select("id, registration, type, spec_sources").in("type", ["PL", "SPL"]),
  ]);

  // Lot A: a PL/SPL vehicle whose type only came from an unconfirmed
  // AI estimate (lib/vehicles/ai-specs.ts) is silently excluded from
  // the export itself (see isTicpeSafeToInclude) — surfaced here so
  // it isn't just missing without explanation.
  const vehiclesToConfirm = (eligibleVehicles ?? []).filter((v: any) => {
    const source = v.spec_sources?.type;
    return source?.origin === "ia" && !source.confirmed;
  });

  return (
    <div>
      <PageHeader
        title="Export TICPE"
        description="Périmètre PL/SPL uniquement — les VL sont exclus par règle métier, jamais par oubli de filtre."
      />

      {vehiclesToConfirm.length > 0 && (
        <Card className="mb-6 border border-gold/40 bg-gold/5">
          <p className="mb-2 text-sm text-gold-ink">
            <IconSparkles className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> {vehiclesToConfirm.length} véhicule(s) ont un type (PL/SPL) estimé par IA, non confirmé — exclus de
            l&apos;export tant qu&apos;un humain ne l&apos;a pas vérifié sur la fiche véhicule :
          </p>
          <ul className="flex flex-col gap-1 text-sm">
            {vehiclesToConfirm.map((v: any) => (
              <li key={v.id}>
                <Link href={`/flotte/vehicules/${v.id}`} className="text-teal-ink hover:underline">
                  {v.registration} ({v.type})
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <TicpeExportForm />

      {!exports || exports.length === 0 ? (
        <EmptyState title="Aucun export généré" />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead className="text-left text-navy/60">
              <tr>
                <th className="pb-2">Généré le</th>
                <th className="pb-2">Période</th>
                <th className="pb-2">Véhicules</th>
                <th className="pb-2">Litres totaux</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {exports.map((exp: any) => (
                <tr key={exp.id} className="border-t border-navy/5">
                  <td className="py-2">{new Date(exp.created_at).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}</td>
                  <td className="py-2">
                    {exp.period_start} → {exp.period_end}
                  </td>
                  <td className="py-2">{exp.vehicle_count}</td>
                  <td className="py-2">{Number(exp.total_liters).toLocaleString("fr-FR")} L</td>
                  <td className="py-2">
                    <div className="flex gap-3">
                      <Link href={`/carburant/ticpe/${exp.id}`} className="text-teal-ink hover:underline">
                        Vérifier
                      </Link>
                      <a href={`/api/ticpe/exports/${exp.id}/download`} className="text-teal-ink hover:underline">
                        Excel
                      </a>
                      {exp.pdf_file_path && (
                        <a href={`/api/ticpe/exports/${exp.id}/download-pdf`} className="text-teal-ink hover:underline">
                          PDF
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

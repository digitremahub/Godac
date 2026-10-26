import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader, StatTile, Card, EmptyState } from "@/components/ui";
import { AlertList } from "@/components/alerts/AlertList";
import { getFleetConsumptionRanking } from "@/lib/vehicles/consumption";
import { resumeBulletinsMois, valeurBulletinsMois } from "@/lib/paie/accueil";
import type { AppUser } from "@/lib/auth/session";
import { summarizeFuelRows, TRUSTED_FUEL_STATUSES, type FuelTotalsRow } from "@/lib/fuel/totals";
import { addDays } from "@/lib/planning/dates";
import { fetchAllRows } from "@/lib/utils/fetch-all";
import { parisDay, parisMonthStartDay, parisMonthStartIso } from "@/lib/utils/paris-time";
import { currentMonth } from "@/lib/planning/dates";
import { chargerAlertes } from "@/lib/alerts/charger";
import { tuilesOuvrables } from "@/lib/acces/tuiles-accueil";

const MOIS = new Intl.DateTimeFormat("fr-FR", { month: "long", timeZone: "Europe/Paris" });

/** Trimestre civil en cours, jours calendaires de Paris (pas ceux du fuseau du serveur). */
function currentQuarterRange(): { start: string; end: string } {
  const month = Number(parisDay().slice(5, 7));
  const offset = -((month - 1) % 3);
  const start = parisMonthStartDay(new Date(), offset);
  const end = addDays(parisMonthStartDay(new Date(), offset + 3), -1);
  return { start, end };
}

/**
 * Accueil du comptable : carburant (dépense, gazole, consommation),
 * factures d'approvisionnement manquantes, paie et TICPE du mois. Le
 * comptable ne décide ni des congés ni des tournées : aucune tuile vers
 * ces écrans. Il n'est rattaché à aucun service : tout est à l'échelle de
 * l'organisation.
 */
export async function ComptableDashboard({ appUser, enabledModules }: { appUser: AppUser; enabledModules: string[] }) {
  const supabase = await createServerSupabaseClient();
  const ticpeEnabled = enabledModules.includes("ticpe_export");
  const payslipsEnabled = enabledModules.includes("payslips");
  const moisCourant = currentMonth();
  const ctx = { role: appUser.role, modules: new Set(enabledModules) };

  // 1er du mois à minuit, heure de Paris.
  const monthStartISO = parisMonthStartIso();
  const { start: quarterStart, end: quarterEnd } = currentQuarterRange();

  const [
    fleetVehiclesRes,
    pendingOcrRes,
    fuelRes,
    missingInvoicesRes,
    missingInvoiceDeliveriesRes,
    ticpeExportRes,
    openAlertsRes,
    bulletinsMoisRes,
    salariesRes,
  ] = await Promise.all([
    supabase.from("vehicles").select("id, registration").eq("status", "active"),
    supabase.from("fuel_entries").select("id", { count: "exact", head: true }).in("status", ["pending_ocr", "awaiting_validation"]),
    // Pleins de confiance du mois, toutes les lignes (plus de .limit() silencieux).
    fetchAllRows<FuelTotalsRow>((a, b) =>
      supabase
        .from("fuel_entries")
        .select("liters, total_amount, status, product")
        .in("status", [...TRUSTED_FUEL_STATUSES])
        .gte("occurred_at", monthStartISO)
        .order("id")
        .range(a, b),
    ),
    supabase.from("tank_deliveries").select("id", { count: "exact", head: true }).is("invoice_path", null),
    supabase
      .from("tank_deliveries")
      .select("id, supplier, liters, delivered_at, tanks(name)")
      .is("invoice_path", null)
      .order("delivered_at", { ascending: false })
      .limit(5),
    ticpeEnabled
      ? supabase.from("ticpe_exports").select("id").lte("period_start", quarterEnd).gte("period_end", quarterStart).maybeSingle()
      : Promise.resolve({ data: null }),
    chargerAlertes(supabase, appUser.id, { ouvertes: true, limite: 5, role: appUser.role }),
    // Bulletins du mois (préparés, validés, refusés à corriger) et salariés actifs.
    payslipsEnabled ? supabase.from("payslips").select("period_start, validation_status").eq("period_start", `${moisCourant}-01`) : Promise.resolve({ data: null }),
    payslipsEnabled ? supabase.from("users").select("id", { count: "exact", head: true }).eq("organization_id", appUser.organization_id).eq("active", true) : Promise.resolve({ count: null }),
  ]);

  const fuelTotals = summarizeFuelRows(fuelRes.rows);
  const fuelSuffix = fuelRes.truncated ? " (tronqué)" : "";
  const missingInvoiceDeliveries = (missingInvoiceDeliveriesRes.data ?? []) as any[];
  const openAlerts = openAlertsRes;
  const ticpeUpToDate = ticpeEnabled ? Boolean(ticpeExportRes.data) : null;

  // Toute la flotte en trois requêtes (plus une série par véhicule).
  const consumptionRanking = await getFleetConsumptionRanking(supabase, (fleetVehiclesRes.data ?? []) as { id: string; registration: string }[], 30);

  return (
    <div>
      <PageHeader title={`Bonjour ${appUser.full_name.split(" ")[0] ?? ""}`} description="Carburant, factures, paie et TICPE du mois." />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {/* La vérification des tickets est réservée à l'encadrement : le comptable consulte la liste filtrée des pleins. */}
        {tuilesOuvrables(
          [
            // La paie du mois en tête : sa tâche du mois.
            payslipsEnabled && {
              libelle: `Bulletins de ${MOIS.format(new Date(`${moisCourant}-15T12:00:00Z`))} (préparés / salariés)`,
              valeur: valeurBulletinsMois(resumeBulletinsMois((bulletinsMoisRes.data ?? []) as { period_start: string; validation_status: string | null }[]), salariesRes.count ?? 0),
              accent: resumeBulletinsMois((bulletinsMoisRes.data ?? []) as { period_start: string; validation_status: string | null }[]).refuses ? "orange" : "teal",
              ecran: "equipe.paie",
            },
            payslipsEnabled && { libelle: "Export comptable du mois", valeur: "Ouvrir", accent: "gold", ecran: "equipe.paie_export" },
            { libelle: "Tickets à vérifier", valeur: String(pendingOcrRes.count ?? 0), accent: "gold", ecran: "carburant.pleins", suite: "?status=awaiting_validation" },
          ],
          ctx,
        ).map((t) => (
          <Link key={t.libelle} href={t.href} className="block">
            <StatTile label={t.libelle} value={t.valeur} accent={t.accent} />
          </Link>
        ))}
        <StatTile label={`Carburant ce mois${fuelSuffix}`} value={`${Math.round(fuelTotals.cost).toLocaleString("fr-FR")} €`} />
        <StatTile
          label={`Gazole ce mois${fuelSuffix}${fuelTotals.adblueLiters > 0 ? ` · AdBlue ${Math.round(fuelTotals.adblueLiters).toLocaleString("fr-FR")} L` : ""}`}
          value={`${Math.round(fuelTotals.gazoleLiters).toLocaleString("fr-FR")} L`}
          accent="gold"
        />
        <Link href="/carburant/approvisionnements" className="block">
          <StatTile
            label="Factures d'approvisionnement manquantes"
            value={String(missingInvoicesRes.count ?? 0)}
            accent={missingInvoicesRes.count ? "orange" : "teal"}
          />
        </Link>
        {ticpeEnabled && (
          <Link href="/carburant/ticpe" className="block">
            <StatTile label="Export TICPE du trimestre" value={ticpeUpToDate ? "À jour" : "À faire"} accent={ticpeUpToDate ? "teal" : "orange"} />
          </Link>
        )}
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6">
        <Card>
          <h2 className="mb-3 text-lg">Consommation (30 jours)</h2>
          {consumptionRanking.length === 0 ? (
            <p className="text-sm text-navy/60">Pas assez de données pour établir un classement.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {consumptionRanking.map((v) => (
                <li key={v.registration} className="flex items-center justify-between rounded-xl bg-navy/[0.035] px-3.5 py-2.5">
                  <span>{v.registration}</span>
                  <span className="font-medium">{v.consumption} L/100km</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg">Approvisionnements sans facture</h2>
            <Link href="/carburant/approvisionnements" className="text-sm text-teal-ink hover:underline">
              Voir tout
            </Link>
          </div>
          {missingInvoiceDeliveries.length === 0 ? (
            <EmptyState title="Aucune facture manquante" description="Tous les approvisionnements récents sont justifiés." />
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {missingInvoiceDeliveries.map((d) => (
                <li key={d.id} className="flex items-center justify-between rounded-xl bg-navy/[0.035] px-3.5 py-2.5">
                  <span>
                    {d.tanks?.name ?? "—"} · {d.supplier ?? "—"} · {d.liters?.toLocaleString("fr-FR")} L
                  </span>
                  <span className="text-xs text-navy/60">{new Date(d.delivered_at).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div>
          <h2 className="mb-3 text-lg">Notifications</h2>
          <AlertList alerts={openAlerts} viewerRole={appUser.role} conduit={appUser.conduit} modules={enabledModules} />
        </div>
      </div>
    </div>
  );
}

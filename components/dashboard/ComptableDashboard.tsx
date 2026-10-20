import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader, StatTile, Card, EmptyState } from "@/components/ui";
import { AlertList } from "@/components/alerts/AlertList";
import { getVehicleConsumption } from "@/lib/vehicles/consumption";
import type { AppUser } from "@/lib/auth/session";
import { summarizeFuelRows, TRUSTED_FUEL_STATUSES, type FuelTotalsRow } from "@/lib/fuel/totals";
import { addDays } from "@/lib/planning/dates";
import { fetchAllRows } from "@/lib/utils/fetch-all";
import { parisDay, parisMonthStartDay, parisMonthStartIso } from "@/lib/utils/paris-time";

/** Trimestre civil en cours, jours calendaires de Paris (pas ceux du fuseau du serveur). */
function currentQuarterRange(): { start: string; end: string } {
  const month = Number(parisDay().slice(5, 7));
  const offset = -((month - 1) % 3);
  const start = parisMonthStartDay(new Date(), offset);
  const end = addDays(parisMonthStartDay(new Date(), offset + 3), -1);
  return { start, end };
}

/**
 * "Exploitation/comptable" is one role: org-wide operational oversight
 * (every service's tours, not just one manager's) plus the admin side
 * — fuel spend, missing supplier invoices, TICPE — rather than a
 * purely financial view. Unlike a Manager they aren't tied to a
 * service, so every query here is organization-wide.
 */
export async function ComptableDashboard({ appUser, enabledModules }: { appUser: AppUser; enabledModules: string[] }) {
  const supabase = await createServerSupabaseClient();
  const ticpeEnabled = enabledModules.includes("ticpe_export");
  const leaveEnabled = enabledModules.includes("leave_management");

  // 1er du mois à minuit, heure de Paris.
  const monthStartISO = parisMonthStartIso();
  const { start: quarterStart, end: quarterEnd } = currentQuarterRange();

  const [
    ongoingToursRes,
    fleetVehiclesRes,
    pendingOcrRes,
    pendingLeaveRes,
    fuelRes,
    missingInvoicesRes,
    missingInvoiceDeliveriesRes,
    ticpeExportRes,
    openAlertsRes,
  ] = await Promise.all([
    supabase
      .from("planning_entries")
      .select("id, tour_number, start_at, vehicles(registration), users!planning_entries_driver_id_fkey(full_name)")
      .eq("status", "in_progress")
      .order("start_at", { ascending: true }),
    supabase.from("vehicles").select("id, registration").eq("status", "active"),
    supabase.from("fuel_entries").select("id", { count: "exact", head: true }).in("status", ["pending_ocr", "awaiting_validation"]),
    leaveEnabled
      ? supabase.from("leave_requests").select("id", { count: "exact", head: true }).eq("status", "pending")
      : Promise.resolve({ count: null }),
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
    supabase
      .from("alerts")
      .select("id, type, severity, message, status, notified_at, created_at, related_table, related_id")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const ongoingTours = (ongoingToursRes.data ?? []) as any as {
    id: string;
    tour_number: string;
    start_at: string;
    vehicles: { registration: string } | null;
    users: { full_name: string } | null;
  }[];
  const fuelTotals = summarizeFuelRows(fuelRes.rows);
  const fuelSuffix = fuelRes.truncated ? " (tronqué)" : "";
  const missingInvoiceDeliveries = (missingInvoiceDeliveriesRes.data ?? []) as any[];
  const openAlerts = (openAlertsRes.data ?? []) as any[];
  const ticpeUpToDate = ticpeEnabled ? Boolean(ticpeExportRes.data) : null;

  const consumptionRanking = (
    await Promise.all(
      ((fleetVehiclesRes.data ?? []) as { id: string; registration: string }[]).map(async (v) => ({
        registration: v.registration,
        consumption: await getVehicleConsumption(supabase, v.id, 30),
      })),
    )
  )
    .filter((v): v is { registration: string; consumption: number } => v.consumption !== null)
    .sort((a, b) => b.consumption - a.consumption)
    .slice(0, 5);

  return (
    <div>
      <PageHeader title={`Bonjour ${appUser.full_name.split(" ")[0] ?? ""}`} description="Vue d'ensemble exploitation & comptabilité." />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Link href="/exploitation/historique" className="block">
          <StatTile label="Tournées en cours" value={String(ongoingTours.length)} accent="teal" />
        </Link>
        {/* La revue OCR est réservée à l'encadrement : le comptable consulte la liste filtrée des pleins. */}
        <Link href="/carburant/pleins?status=awaiting_validation" className="block">
          <StatTile label="Tickets OCR en attente" value={String(pendingOcrRes.count ?? 0)} accent="gold" />
        </Link>
        {leaveEnabled && (
          <Link href="/moi/conges" className="block">
            <StatTile label="Congés en attente" value={String(pendingLeaveRes.count ?? 0)} accent="gold" />
          </Link>
        )}
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

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="mb-3 text-lg">Tournées en cours</h2>
          {ongoingTours.length === 0 ? (
            <p className="text-sm text-navy/60">Aucune tournée en cours actuellement.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {ongoingTours.map((t) => (
                <li key={t.id} className="flex items-center justify-between rounded-xl bg-navy/[0.035] px-3.5 py-2.5">
                  <span>
                    {t.users?.full_name ?? "—"} · {t.vehicles?.registration ?? "—"} · n°{t.tour_number}
                  </span>
                  <span className="text-xs text-navy/60">
                    depuis {new Date(t.start_at).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

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
          <AlertList alerts={openAlerts} viewerRole={appUser.role} />
        </div>
      </div>
    </div>
  );
}

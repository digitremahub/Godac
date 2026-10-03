import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { mondayOf, toISODate, addDays } from "@/lib/planning/dates";

const DAY_LABELS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const STATUS_BADGE: Record<string, string> = {
  planned: "badge-neutral",
  in_progress: "badge-gold",
  done: "badge-teal",
};
const STATUS_LABEL: Record<string, string> = {
  planned: "Prévue",
  in_progress: "En cours",
  done: "Terminée",
};

/**
 * Read-only, own-tours-only counterpart to the manager-facing
 * /planning grid — a chauffeur has no reason to see other drivers'
 * assignments or drag anything around, just "what am I doing this
 * week". RLS (planning_entries: read within org,
 * driver_id = current_app_user_id()) already scopes this correctly
 * for any role, so no new policy is needed.
 */
export default async function MyPlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const params = await searchParams;
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();

  const planningEnabled = await isModuleEnabled(supabase, appUser.organization_id, "planning");
  if (!planningEnabled) {
    return (
      <EmptyState
        title="Module Planning non activé"
        description="Contactez votre gestionnaire pour l'activer."
      />
    );
  }

  const weekStart = toISODate(mondayOf(params.week && !Number.isNaN(Date.parse(params.week)) ? new Date(params.week) : new Date()));
  const weekEnd = addDays(weekStart, 7);
  const prevWeek = addDays(weekStart, -7);
  const nextWeek = addDays(weekStart, 7);

  const { data: entries } = await supabase
    .from("planning_entries")
    .select("id, tour_number, start_at, end_at, status, vehicles(registration), services(name)")
    .eq("driver_id", appUser.id)
    .gte("start_at", `${weekStart}T00:00:00`)
    .lt("start_at", `${weekEnd}T00:00:00`)
    .order("start_at");

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  return (
    <div>
      <PageHeader title="Mon planning" description="Vos tournées prévues et effectuées, semaine par semaine." />

      <div className="mb-4 flex items-center gap-3">
        <Link href={`/planning/mine?week=${prevWeek}`} className="btn-secondary !px-3 !py-1.5 text-sm">
          ← Semaine préc.
        </Link>
        <span className="text-sm text-navy/60">Semaine du {weekStart.split("-").reverse().join("/")}</span>
        <Link href={`/planning/mine?week=${nextWeek}`} className="btn-secondary !px-3 !py-1.5 text-sm">
          Semaine suiv. →
        </Link>
      </div>

      {(entries ?? []).length === 0 ? (
        <EmptyState title="Aucune tournée cette semaine" description="Rien ne vous est encore assigné pour cette période." />
      ) : (
        <div className="flex flex-col gap-4">
          {days.map((dayISO, i) => {
            const dayEntries = (entries ?? []).filter((e: any) => e.start_at.slice(0, 10) === dayISO);
            if (dayEntries.length === 0) return null;
            return (
              <div key={dayISO}>
                <p className="mb-2 text-sm font-medium capitalize text-navy/60">
                  {DAY_LABELS[i]} {dayISO.split("-").reverse().join("/")}
                </p>
                <div className="flex flex-col gap-2">
                  {dayEntries.map((entry: any) => (
                    <Card key={entry.id} className="flex items-center justify-between gap-4">
                      <div>
                        <p className="font-medium">
                          Tournée n°{entry.tour_number} {entry.services ? `· ${entry.services.name}` : ""}
                        </p>
                        <p className="text-sm text-navy/60">{entry.vehicles?.registration ?? "Véhicule non précisé"}</p>
                        <p className="text-xs text-navy/40">
                          {new Date(entry.start_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                          {entry.end_at
                            ? ` → ${new Date(entry.end_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`
                            : ""}
                        </p>
                      </div>
                      <span className={STATUS_BADGE[entry.status] ?? "badge-neutral"}>
                        {STATUS_LABEL[entry.status] ?? entry.status}
                      </span>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

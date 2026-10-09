import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { ClockButton } from "@/components/time-clock/ClockButton";

function formatDuration(startIso: string, endIso: string | null) {
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const minutes = Math.round((end - start) / 60000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${m.toString().padStart(2, "0")}`;
}

/**
 * Raw clock-in/out log (Module Pointeuse Électronique) — a direction-
 * visible badge button plus history, not yet wired into payroll
 * (/payroll still reads user_contracts directly). Direction sees
 * everyone's entries for the period; everyone else only their own.
 */
export default async function TimeClockPage() {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();

  const timeClockEnabled = await isModuleEnabled(supabase, appUser.organization_id, "time_clock");
  if (!timeClockEnabled) {
    return (
      <EmptyState
        title="Module Pointeuse non activé"
        description="Activez-le depuis les paramètres de votre organisation pour suivre les heures badgées."
      />
    );
  }

  const isDirection = appUser.role === "direction";

  const { data: openEntry } = await supabase
    .from("time_clock_entries")
    .select("id")
    .eq("user_id", appUser.id)
    .is("clocked_out_at", null)
    .maybeSingle();

  let query = supabase
    .from("time_clock_entries")
    .select("id, clocked_in_at, clocked_out_at, users(full_name)")
    .order("clocked_in_at", { ascending: false })
    .limit(100);
  if (!isDirection) query = query.eq("user_id", appUser.id);

  const { data: entries } = await query;

  return (
    <div>
      <PageHeader title="Pointeuse électronique" description="Badgez votre entrée et votre sortie de poste." />

      <div className="mb-6 max-w-sm">
        <ClockButton clockedIn={Boolean(openEntry)} />
      </div>

      <h3 className="mb-2 text-base">{isDirection ? "Historique (tous les employés)" : "Mon historique"}</h3>
      {(entries ?? []).length === 0 ? (
        <EmptyState title="Aucun badgeage enregistré." />
      ) : (
        <Card className="flex flex-col gap-1.5">
          {(entries ?? []).map((e: any) => (
            <div key={e.id} className="flex items-center justify-between border-t border-navy/5 py-1.5 text-sm first:border-t-0 first:pt-0">
              <span>
                {isDirection && <span className="font-medium">{e.users?.full_name ?? "—"} — </span>}
                {new Date(e.clocked_in_at).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                {" → "}
                {e.clocked_out_at
                  ? new Date(e.clocked_out_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
                  : "en cours"}
              </span>
              <span className="text-xs text-navy/40">{formatDuration(e.clocked_in_at, e.clocked_out_at)}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

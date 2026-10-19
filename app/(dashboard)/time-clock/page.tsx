import { garderPage } from "@/lib/acces/garde-page";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { ClockButton } from "@/components/time-clock/ClockButton";
import { classifyLocation, LOCATION_LABEL_DISPLAY } from "@/lib/time-clock/classify-location";
import { buildDriverDepotsMap } from "@/lib/time-clock/driver-depots";
import type { Coordinates } from "@/lib/business/fuel-profitability";
import { IconMapPin } from "@/components/layout/icons";

function formatDuration(startIso: string, endIso: string | null) {
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const minutes = Math.round((end - start) / 60000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${m.toString().padStart(2, "0")}`;
}

function toCoords(lat: unknown, lng: unknown): Coordinates | null {
  return lat !== null && lat !== undefined && lng !== null && lng !== undefined ? { lat: Number(lat), lng: Number(lng) } : null;
}

/**
 * "Autre lieu" / "position inconnue" alone doesn't let direction
 * actually locate a badge GPS doesn't match the depot or the
 * driver's home — a map link next to the label does, whenever a
 * coordinate was actually captured (nothing to link to otherwise).
 */
function mapLink(coords: Coordinates | null) {
  if (!coords) return null;
  return (
    <a
      href={`https://www.google.com/maps?q=${coords.lat},${coords.lng}`}
      target="_blank"
      rel="noreferrer"
      className="ml-1 text-teal-ink underline"
    >
      <IconMapPin className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Voir
    </a>
  );
}

/**
 * Raw clock-in/out log (Module Pointeuse Électronique) — a direction-
 * visible badge button plus history, not yet wired into payroll
 * (/payroll still reads user_contracts directly) and deliberately so
 * for now: this is a comparison tool first. Each badge is tagged
 * against the depot and the driver's own home (lib/time-clock/
 * classify-location.ts) so direction can cross-check "badged in at
 * the depot" vs "badged in from home" before trusting it for hours.
 */
export default async function TimeClockPage() {
  const g = await garderPage("moi.pointage");
  if (!g.ok) return g.ecran;
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();


  const isDirection = appUser.role === "direction";

  const [{ data: openEntry }, { depotsFor }] = await Promise.all([
    supabase.from("time_clock_entries").select("id").eq("user_id", appUser.id).is("clocked_out_at", null).maybeSingle(),
    buildDriverDepotsMap(supabase, appUser.organization_id),
  ]);

  let query = supabase
    .from("time_clock_entries")
    .select(
      "id, clocked_in_at, clocked_out_at, clock_in_source, clock_in_lat, clock_in_lng, clock_out_lat, clock_out_lng, users(full_name, address_lat, address_lng)",
    )
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
          {(entries ?? []).map((e: any) => {
            const homeCoords = toCoords(e.users?.address_lat, e.users?.address_lng);
            const inCoords = toCoords(e.clock_in_lat, e.clock_in_lng);
            const outCoords = e.clocked_out_at ? toCoords(e.clock_out_lat, e.clock_out_lng) : null;
            const depotCoords = depotsFor(e.users?.id ?? "");
            const inLocation = classifyLocation(inCoords, depotCoords, homeCoords);
            const outLocation = e.clocked_out_at ? classifyLocation(outCoords, depotCoords, homeCoords) : null;
            return (
              <div key={e.id} className="flex items-center justify-between border-t border-navy/5 py-1.5 text-sm first:border-t-0 first:pt-0">
                <span>
                  {isDirection && <span className="font-medium">{e.users?.full_name ?? "—"} — </span>}
                  {new Date(e.clocked_in_at).toLocaleString("fr-FR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "Europe/Paris",
                  })}
                  <span className="ml-1 text-xs text-navy/60">
                    ({LOCATION_LABEL_DISPLAY[inLocation]}){mapLink(inCoords)}
                    {e.clock_in_source === "auto" && (
                      <span className="badge-teal ml-2" title="Entrée pointée automatiquement au dépôt (pointage assisté)">
                        Assisté
                      </span>
                    )}
                  </span>
                  {" → "}
                  {e.clocked_out_at ? (
                    <>
                      {new Date(e.clocked_out_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" })}
                      <span className="ml-1 text-xs text-navy/60">
                        ({LOCATION_LABEL_DISPLAY[outLocation!]}){mapLink(outCoords)}
                      </span>
                    </>
                  ) : (
                    "en cours"
                  )}
                </span>
                <span className="text-xs text-navy/60">{formatDuration(e.clocked_in_at, e.clocked_out_at)}</span>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}

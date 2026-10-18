import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const ROLES_GESTION = ["direction", "manager", "manager_chauffeur"];
const DEFAUT = [
  { label: "8 h – 11 h", start: "08:00", end: "11:00" },
  { label: "10 h – 13 h", start: "10:00", end: "13:00" },
  { label: "12 h – 15 h", start: "12:00", end: "15:00" },
  { label: "14 h – 17 h", start: "14:00", end: "17:00" },
];
const creneauSchema = z.object({
  label: z.string().trim().min(1).max(40),
  start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  end: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
}).refine((v) => v.start < v.end, { message: "L'heure de fin doit être après le début." });
const bodySchema = z.object({
  service_id: z.string().uuid(),
  windows: z.array(creneauSchema).max(12),
});

function todayParis() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
}
function dayBounds(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  return {
    from: new Date(d.getTime() - 86_400_000).toISOString(),
    to: new Date(d.getTime() + 86_400_000).toISOString(),
  };
}

/** Créneaux par service. Gestionnaires : configuration de tous les services.
 * Chauffeurs : union des créneaux des services qui leur sont affectés aujourd'hui. */
export async function GET() {
  const user = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  const { data: services, error } = await supabase
    .from("services")
    .select("id, name, delivery_time_windows")
    .eq("organization_id", user.organization_id)
    .order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const normalized = (services ?? []).map((s: any) => ({
    id: s.id,
    name: s.name,
    windows: Array.isArray(s.delivery_time_windows) ? s.delivery_time_windows : DEFAUT,
  }));
  if (ROLES_GESTION.includes(user.role)) return NextResponse.json({ services: normalized });

  const bounds = dayBounds(todayParis());
  const { data: entries, error: planningError } = await supabase
    .from("planning_entries")
    .select("service_id, start_at")
    .eq("organization_id", user.organization_id)
    .eq("driver_id", user.id)
    .in("status", ["planned", "in_progress"])
    .gte("start_at", bounds.from)
    .lt("start_at", bounds.to);
  if (planningError) return NextResponse.json({ error: planningError.message }, { status: 500 });
  const jour = todayParis();
  const serviceIds = new Set((entries ?? [])
    .filter((e: any) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(e.start_at)) === jour)
    .map((e: any) => e.service_id)
    .filter(Boolean));
  const windows = new Map<string, { label: string; start: string; end: string }>();
  for (const service of normalized.filter((s) => serviceIds.has(s.id))) {
    for (const w of service.windows) {
      if (w && typeof w.label === "string" && typeof w.start === "string" && typeof w.end === "string") {
        windows.set(`${w.start}-${w.end}`, w);
      }
    }
  }
  return NextResponse.json({ windows: windows.size ? [...windows.values()] : DEFAUT });
}

export async function PUT(req: Request) {
  const user = await requireAppUser();
  if (!ROLES_GESTION.includes(user.role)) {
    return NextResponse.json({ error: "Seule la Direction et l'encadrement peuvent modifier les créneaux par service." }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Créneaux invalides : vérifiez les libellés et les heures." }, { status: 400 });
  const seen = new Set<string>();
  for (const w of parsed.data.windows) {
    const key = `${w.start}-${w.end}`;
    if (seen.has(key)) return NextResponse.json({ error: "Ce créneau existe déjà." }, { status: 400 });
    seen.add(key);
  }
  const supabase = await createServerSupabaseClient();
  const { data: service, error } = await supabase
    .from("services")
    .update({ delivery_time_windows: parsed.data.windows })
    .eq("id", parsed.data.service_id)
    .eq("organization_id", user.organization_id)
    .select("id, name, delivery_time_windows")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!service) return NextResponse.json({ error: "Service introuvable." }, { status: 404 });
  return NextResponse.json({ service: { id: service.id, name: service.name, windows: service.delivery_time_windows } });
}

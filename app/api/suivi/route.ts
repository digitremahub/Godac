import { NextResponse } from "next/server";
import { requireAppUser, hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { cleAdresse, horairesDesAdresses, moduleActif, aujourdhuiParis } from "@/lib/colis/serveur";
import { estimerAvancement } from "@/lib/colis/estimation";
import { fenetresArret } from "@/lib/colis/horaires";

export interface TourneeSuivie {
  id: string;
  nom: string | null;
  chauffeur: string;
  services: { id: string; nom: string }[];
  statut: "loading" | "in_progress" | "done";
  position: { lat: number; lng: number; at: string } | null;
  depot: { lat: number; lng: number } | null;
  arrets: { lat: number | null; lng: number | null; status: string; ordre: number; ramasse?: boolean; adresse: string; destinataire: string | null; telephone: string | null; colis: number }[];
  adressesRestantes: number;
  colisRestants: number;
  adressesFaites: number;
  adressesTotal: number;
  finEstimee: string | null;
  methode: "rythme" | "estimation" | null;
}

/**
 * Tournées colis du jour pour la carte de suivi (direction, managers) :
 * dernière position partagée, arrêts, restants et fin estimée. Filtre
 * facultatif par service (?service=). RLS : encadrement de l'entreprise.
 */
export async function GET(req: Request) {
  const appUser = await requireAppUser();
  if (!hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"])) return NextResponse.json({ error: "Réservé à l'encadrement." }, { status: 403 });
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const service = new URL(req.url).searchParams.get("service");

  const { data: runs } = await supabase
    .from("delivery_runs")
    .select(
      "id, name, status, driver_id, start_lat, start_lng, return_to_start, last_lat, last_lng, last_position_at, users!delivery_runs_driver_id_fkey(full_name, user_services(services(id, name))), delivery_stops(status, kind, parcel_count, lat, lng, done_at, position, address, recipient, phone, window_start, window_end)",
    )
    .eq("run_date", aujourdhuiParis())
    .in("status", ["in_progress", "loading", "done"])
    .order("created_at");

  const maintenant = new Date();
  // Horaires des adresses pro restantes : la fin estimée compte l'attente à l'ouverture.
  const jour = aujourdhuiParis();
  const fiches = await horairesDesAdresses(
    supabase,
    appUser.organization_id,
    ((runs ?? []) as any[]).flatMap((r) => ((r.delivery_stops ?? []) as any[]).filter((s) => s.status === "pending").map((s) => s.address as string)),
  );
  const tournees: TourneeSuivie[] = ((runs ?? []) as any[])
    .map((r) => {
      const services = ((r.users?.user_services ?? []) as any[]).map((us) => us.services).filter(Boolean).map((s: any) => ({ id: s.id, nom: s.name }));
      const stops = ((r.delivery_stops ?? []) as any[]).sort((a, b) => a.position - b.position);
      const position = r.last_lat !== null && r.last_lng !== null ? { lat: Number(r.last_lat), lng: Number(r.last_lng), at: r.last_position_at as string } : null;
      const depot = r.start_lat !== null && r.start_lng !== null ? { lat: Number(r.start_lat), lng: Number(r.start_lng) } : null;
      const av = estimerAvancement(
        stops.map((s) => ({
          status: s.status,
          parcel_count: s.parcel_count,
          lat: s.lat === null ? null : Number(s.lat),
          lng: s.lng === null ? null : Number(s.lng),
          done_at: s.done_at,
          fenetres: s.status === "pending" ? fenetresArret({ semaine: fiches.get(cleAdresse(s.address ?? ""))?.weekly_schedule, debut: s.window_start, fin: s.window_end }, jour) : null,
        })),
        { maintenant, position, depot, retourDepot: r.return_to_start },
      );
      return {
        id: r.id,
        nom: r.name,
        chauffeur: r.users?.full_name ?? "—",
        services,
        statut: r.status,
        position,
        depot,
        arrets: stops.map((s, i) => ({ lat: s.lat === null ? null : Number(s.lat), lng: s.lng === null ? null : Number(s.lng), status: s.status, ordre: i + 1, ramasse: s.kind === "ramasse", adresse: s.address ?? "Adresse non renseignée", destinataire: s.recipient ?? null, telephone: s.phone ?? null, colis: Number(s.parcel_count ?? 1) })),
        ...av,
        finEstimee: r.status === "in_progress" ? av.finEstimee : null,
      };
    })
    .filter((t) => !service || t.services.some((s) => s.id === service));

  return NextResponse.json({ tournees, maj: maintenant.toISOString() });
}

import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { moduleActif } from "@/lib/colis/serveur";
import { chargerTourneesSuivies } from "@/lib/exploitation/suivi-serveur";
import { notifierRetards } from "@/lib/exploitation/retards-serveur";

export type { TourneeSuivie } from "@/lib/exploitation/suivi-serveur";

/**
 * Tournées colis du jour pour la carte de suivi (direction, exploitation,
 * managers) : dernière position partagée, arrêts, restants, fin estimée et
 * retard. Filtre facultatif par service (?service=). Exploitation et
 * direction : toute l'entreprise ; manager : les chauffeurs de ses services.
 * La notification des retards est portée par le cron de surveillance
 * (toutes les 5 minutes) ; `?ouverture=1` (premier chargement de l'écran)
 * la déclenche aussi, dédoublonnée, comme filet. Les rafraîchissements
 * suivants n'écrivent rien.
 */
export async function GET(req: Request) {
  const g = await garderApi({ roles: ["direction", "manager", "exploitation"], modules: ["route_optimizer"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (!hasRole(appUser.role, ["manager", "exploitation", "direction"])) return NextResponse.json({ error: "Réservé à l'encadrement." }, { status: 403 });
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const parametres = new URL(req.url).searchParams;
  const service = parametres.get("service");

  const maintenant = new Date();
  const tournees = await chargerTourneesSuivies(supabase, appUser, { service, maintenant });
  // Filet à l'ouverture de l'écran seulement : jamais bloquant pour l'affichage.
  if (parametres.get("ouverture") === "1") await notifierRetards(appUser.organization_id, tournees);

  return NextResponse.json({ tournees, maj: maintenant.toISOString() });
}

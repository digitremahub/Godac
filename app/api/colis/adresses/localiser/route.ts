import { NextResponse } from "next/server";
import { garderApi } from "@/lib/acces/garde-api";
import { codePays } from "@/lib/pays/serveur";
import { geocodeAddress } from "@/lib/geo/geocode";

export const dynamic = "force-dynamic";

/**
 * Coordonnées d'une adresse saisie (départ ou arrivée de l'optimisation
 * choisis hors tournée) quand la suggestion n'en portait pas : même
 * géocodage que le reste de la tournée colis.
 */
export async function GET(req: Request) {
  const g = await garderApi({ modules: ["route_optimizer"] });
  if (!g.ok) return g.reponse;
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < 3 || q.length > 200) return NextResponse.json({ error: "Adresse trop courte." }, { status: 400 });
  const pays = await codePays(g.appUser.organization_id).catch(() => "FR");
  const p = await geocodeAddress(q, pays);
  if (!p) return NextResponse.json({ error: "Adresse introuvable : précisez la rue et la ville." }, { status: 404 });
  return NextResponse.json(p);
}

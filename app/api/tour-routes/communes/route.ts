import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { chercherSuggestionsCommunes } from "@/lib/tours/ajout-village-serveur";

/**
 * Suggestions de communes (nom, code postal, département, coordonnées) pour
 * l'ajout d'un village : « Ponteilla », « 66300 » ou « Ponteilla 66300 ».
 */
export async function GET(req: Request) {
  const g = await garderApi({ modulesAuMoinsUn: ["planning", "route_optimizer"] });
  if (!g.ok) return g.reponse;
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 100);
  return NextResponse.json(await chercherSuggestionsCommunes(q));
}

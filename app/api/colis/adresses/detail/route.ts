import { NextResponse } from "next/server";
import { garderApi } from "@/lib/acces/garde-api";
import { cleGoogle, lireDetail, MASQUE_DETAIL, placeIdValide, sessionValide, URL_DETAIL } from "@/lib/colis/places-google";

export const dynamic = "force-dynamic";

/**
 * Coordonnées d'une suggestion Google, demandées seulement au choix
 * (Place Details, champs minimaux : location, formattedAddress, displayName),
 * avec le même jeton de session que l'Autocomplete pour limiter le coût.
 */
export async function GET(req: Request) {
  const g = await garderApi({ modules: ["route_optimizer"] });
  if (!g.ok) return g.reponse;
  const url = new URL(req.url);
  const placeId = url.searchParams.get("place_id");
  const session = url.searchParams.get("session");
  const cle = cleGoogle(process.env);
  if (!cle || !placeIdValide(placeId)) return NextResponse.json({ lieu: null }, { status: cle ? 400 : 200 });
  try {
    const p = new URLSearchParams({ languageCode: "fr" });
    if (sessionValide(session)) p.set("sessionToken", session);
    const res = await fetch(`${URL_DETAIL}${encodeURIComponent(placeId)}?${p.toString()}`, {
      headers: { "X-Goog-Api-Key": cle, "X-Goog-FieldMask": MASQUE_DETAIL },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return NextResponse.json({ lieu: null });
    return NextResponse.json({ lieu: lireDetail(await res.json()) });
  } catch {
    return NextResponse.json({ lieu: null });
  }
}

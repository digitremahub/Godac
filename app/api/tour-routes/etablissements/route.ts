import { NextResponse } from "next/server";
import { garderApi } from "@/lib/acces/garde-api";
import { codePays } from "@/lib/pays/serveur";
import { lireBiais, ordonnerRapide } from "@/lib/colis/recherche-adresses";
import { cleGoogle, lireDetail, MASQUE_DETAIL, placeIdValide, sessionValide, URL_DETAIL } from "@/lib/colis/places-google";
import { annuaireInterne, baseAdresseNationale, delai, DELAI_ANNUAIRE_MS, DELAI_PRO_MS, entreprises, googlePlaces, photon } from "@/lib/colis/recherche-adresses-serveur";
import { classerParProximite } from "@/lib/tours/ajout-arret";

export const dynamic = "force-dynamic";

/**
 * Établissements et adresses pour les ramasses et points relais d'une fiche
 * de tournée : mêmes sources, mêmes délais et même clé Google que le champ
 * adresse de la tournée colis (annuaire interne, Google Places si une clé
 * existe, sinon BAN puis OpenStreetMap en complément). Biaisé autour du
 * village (`lat`, `lng`) ; les résultats proches passent devant.
 *  - `phase=rapide` (défaut) puis `phase=complement` ;
 *  - `place_id` : coordonnées d'une suggestion Google (Place Details).
 */
export async function GET(req: Request) {
  const g = await garderApi({ modulesAuMoinsUn: ["planning", "route_optimizer"] });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const url = new URL(req.url);
  const cle = cleGoogle(process.env);
  const session = url.searchParams.get("session");

  const placeId = url.searchParams.get("place_id");
  if (placeId) {
    if (!cle || !placeIdValide(placeId)) return NextResponse.json({ lieu: null });
    try {
      const p = new URLSearchParams({ languageCode: "fr" });
      if (sessionValide(session)) p.set("sessionToken", session);
      const res = await fetch(`${URL_DETAIL}${encodeURIComponent(placeId)}?${p.toString()}`, {
        headers: { "X-Goog-Api-Key": cle, "X-Goog-FieldMask": MASQUE_DETAIL },
        signal: AbortSignal.timeout(3000),
      });
      return NextResponse.json({ lieu: res.ok ? lireDetail(await res.json()) : null });
    } catch {
      return NextResponse.json({ lieu: null });
    }
  }

  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 3 || q.length > 160) return NextResponse.json({ resultats: [], complement: false });
  const biais = lireBiais(url.searchParams.get("lat"), url.searchParams.get("lng"));
  const phase = url.searchParams.get("phase") === "complement" ? "complement" : "rapide";
  const pays = await codePays(appUser.organization_id).catch(() => "FR");

  if (phase === "complement") {
    if (cle) return NextResponse.json({ resultats: [], complement: false });
    return NextResponse.json({ resultats: classerParProximite(await photon(q, biais, pays), biais), complement: false });
  }
  const [annuaire, principal, pros] = await Promise.all([
    delai(annuaireInterne(supabase, appUser.organization_id, q), DELAI_ANNUAIRE_MS),
    cle ? googlePlaces(cle, q, biais, pays, sessionValide(session) ? session : null) : pays === "FR" ? baseAdresseNationale(q, biais) : Promise.resolve([]),
    // Professionnels par leur nom (SIRENE, gratuit, sans clé) : France, en complément de la source principale.
    pays === "FR" ? delai(entreprises(q, biais), DELAI_PRO_MS) : Promise.resolve([]),
  ]);
  return NextResponse.json({ resultats: classerParProximite(ordonnerRapide(annuaire, principal, 8, pros, q), biais), complement: !cle });
}

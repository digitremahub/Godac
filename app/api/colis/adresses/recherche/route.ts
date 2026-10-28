import { NextResponse } from "next/server";
import { garderApi } from "@/lib/acces/garde-api";
import { codePays } from "@/lib/pays/serveur";
import { lireBiais, ordonnerRapide } from "@/lib/colis/recherche-adresses";
import { cleGoogle, sessionValide } from "@/lib/colis/places-google";
import { annuaireInterne, baseAdresseNationale, delai, DELAI_ANNUAIRE_MS, DELAI_PRO_MS, entreprises, googlePlaces, photon } from "@/lib/colis/recherche-adresses-serveur";

export const dynamic = "force-dynamic";

/**
 * Champ adresse de la tournée colis, en deux temps.
 *  - `phase=rapide` (défaut) : Google Places Autocomplete si une clé existe
 *    (GOOGLE_PLACES_API_KEY ou GOOGLE_MAPS_API_KEY), sinon la Base Adresse
 *    Nationale (France), plus l'annuaire interne si il répond en < 0,7 s.
 *    Les coordonnées Google sont résolues au choix (/api/colis/adresses/detail).
 *  - `phase=complement` (sans clé Google seulement) : OpenStreetMap (Photon,
 *    plus lent), timeout 1,5 s, que le client ajoute à la liste affichée.
 * Une source en panne ou lente ne bloque jamais la réponse.
 */
export async function GET(req: Request) {
  const g = await garderApi({ modules: ["route_optimizer"] });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 3 || q.length > 160) return NextResponse.json({ resultats: [], complement: false });
  const biais = lireBiais(url.searchParams.get("lat"), url.searchParams.get("lng"));
  const session = url.searchParams.get("session");
  const phase = url.searchParams.get("phase") === "complement" ? "complement" : "rapide";
  const cle = cleGoogle(process.env);
  const pays = await codePays(appUser.organization_id).catch(() => "FR");

  if (phase === "complement") {
    if (cle) return NextResponse.json({ resultats: [], complement: false });
    return NextResponse.json({ resultats: await photon(q, biais, pays), complement: false });
  }

  const [annuaire, principal, pros] = await Promise.all([
    delai(annuaireInterne(supabase, appUser.organization_id, q), DELAI_ANNUAIRE_MS),
    cle ? googlePlaces(cle, q, biais, pays, sessionValide(session) ? session : null) : pays === "FR" ? baseAdresseNationale(q, biais) : Promise.resolve([]),
    // Professionnels par leur nom (SIRENE, gratuit, sans clé) : France, en complément de la source principale.
    pays === "FR" ? delai(entreprises(q, biais), DELAI_PRO_MS) : Promise.resolve([]),
  ]);
  // Sans clé Google : le client enchaîne sur la phase « complement » (établissements OSM).
  return NextResponse.json({ resultats: ordonnerRapide(annuaire, principal, 8, pros, q), complement: !cle });
}

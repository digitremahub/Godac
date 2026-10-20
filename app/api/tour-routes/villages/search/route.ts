import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const g = await garderApi({ modulesAuMoinsUn: ["planning", "route_optimizer"] });
  if (!g.ok) return g.reponse;
  const params = new URL(req.url).searchParams;
  const query = params.get("q")?.trim() ?? "";
  // type=commune : seulement des communes (ajout d'un village), le nom
  // renvoyé est celui de la commune et non celui d'une rue.
  const communes = params.get("type") === "commune";
  if (query.length < 3) return NextResponse.json({ results: [] });
  try {
    const url = new URL("https://api-adresse.data.gouv.fr/search/");
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "8");
    url.searchParams.set("autocomplete", "1");
    if (communes) url.searchParams.set("type", "municipality");
    const response = await fetch(url, { headers: { Accept: "application/json" }, next: { revalidate: 60 } });
    if (!response.ok) return NextResponse.json({ results: [] });
    const data = await response.json();
    const results = (data.features ?? []).map((feature: any) => ({
      name: String((communes ? feature.properties?.city : null) ?? feature.properties?.name ?? feature.properties?.label ?? ""),
      postal_code: feature.properties?.postcode ? String(feature.properties.postcode) : null,
      label: String(feature.properties?.label ?? ""),
      // « 38, Isère, Auvergne-Rhône-Alpes » : distingue les homonymes.
      context: feature.properties?.context ? String(feature.properties.context) : null,
    })).filter((item: { name: string }) => item.name);
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: [] });
  }
}

import { NextResponse } from "next/server";
import { requireAppUser } from "@/lib/auth/session";

export async function GET(req: Request) {
  await requireAppUser();
  const query = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 3) return NextResponse.json({ results: [] });
  try {
    const url = new URL("https://api-adresse.data.gouv.fr/search/");
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "8");
    url.searchParams.set("autocomplete", "1");
    const response = await fetch(url, { headers: { Accept: "application/json" }, next: { revalidate: 60 } });
    if (!response.ok) return NextResponse.json({ results: [] });
    const data = await response.json();
    const results = (data.features ?? []).map((feature: any) => ({
      name: String(feature.properties?.name ?? feature.properties?.label ?? ""),
      postal_code: feature.properties?.postcode ? String(feature.properties.postcode) : null,
      label: String(feature.properties?.label ?? ""),
    })).filter((item: { name: string }) => item.name);
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: [] });
  }
}

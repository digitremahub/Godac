import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const country = (url.searchParams.get("country") ?? "FR").toLowerCase();
  if (q.length < 3 || q.length > 160) {
    return NextResponse.json({ results: [] });
  }
  if (!/^[a-z]{2}$/.test(country)) {
    return NextResponse.json({ error: "Pays invalide." }, { status: 400 });
  }

  try {
    const params = new URLSearchParams({
      format: "jsonv2",
      q,
      limit: "6",
      countrycodes: country,
      addressdetails: "1",
      namedetails: "1",
      "accept-language": "fr",
      dedupe: "1",
    });
    const res = await fetch(`${NOMINATIM}?${params.toString()}`, {
      headers: {
        "User-Agent": "GODAC/1.0 (business address autocomplete; https://godac-v2.vercel.app)",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(5000),
      next: { revalidate: 60 },
    });
    if (!res.ok) return NextResponse.json({ results: [] });
    const hits = await res.json() as {
      display_name?: string;
      name?: string;
      type?: string;
      class?: string;
      category?: string;
      address?: Record<string, string>;
    }[];
    const results = hits.map((hit) => {
      const name = hit.name || hit.address?.shop || hit.address?.amenity || hit.address?.office || hit.address?.industrial || "";
      const detail = [hit.address?.house_number, hit.address?.road, hit.address?.postcode, hit.address?.city || hit.address?.town || hit.address?.village]
        .filter(Boolean)
        .join(" ");
      // Affiche le nom de l'entreprise en premier, comme un résultat de recherche,
      // puis l'adresse pour distinguer les établissements homonymes.
      const label = name && detail ? `${name} — ${detail}` : hit.display_name ?? name;
      return {
        label,
        ...(hit.display_name && hit.display_name !== label ? { detail: hit.display_name } : {}),
      };
    }).filter((item) => item.label);
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: [] });
  }
}

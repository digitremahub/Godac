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
    const hits = res.ok ? await res.json() as {
      display_name?: string;
      name?: string;
      type?: string;
      class?: string;
      category?: string;
      address?: Record<string, string>;
    }[] : [];
    const results = hits.map((hit) => {
      const name = hit.name || hit.address?.shop || hit.address?.amenity || hit.address?.office || hit.address?.industrial || hit.address?.company || "";
      const detail = [hit.address?.house_number, hit.address?.road, hit.address?.postcode, hit.address?.city || hit.address?.town || hit.address?.village]
        .filter(Boolean)
        .join(" ");
      const label = name && detail ? `${name} — ${detail}` : hit.display_name ?? name;
      return { label, ...(hit.display_name && hit.display_name !== label ? { detail: hit.display_name } : {}) };
    }).filter((item) => item.label);

    // Nominatim est bon pour les adresses, mais ne retrouve pas toujours les
    // entreprises quand l'utilisateur ne saisit que leur nom. Photon complète
    // la recherche par nom de lieu/commerce, puis l'adresse est montrée pour
    // que le chauffeur puisse choisir le bon établissement.
    if (results.length < 3) {
      try {
        const photonParams = new URLSearchParams({ q, limit: "8", lang: "fr", lat: "46.6", lon: "2.5" });
        const photonRes = await fetch(`https://photon.komoot.io/api/?${photonParams.toString()}`, {
          headers: { "Accept": "application/json", "User-Agent": "GODAC/1.0 (business address autocomplete; https://godac-v2.vercel.app)" },
          signal: AbortSignal.timeout(4000),
          next: { revalidate: 60 },
        });
        if (photonRes.ok) {
          const photon = await photonRes.json() as { features?: { properties?: Record<string, string | undefined> }[] };
          for (const feature of photon.features ?? []) {
            const p = feature.properties ?? {};
            const nom = p.name || p.street || "";
            const adresse = [p.housenumber, p.street, p.postcode, p.city || p.town || p.village].filter(Boolean).join(" ");
            const label = nom && adresse ? `${nom} — ${adresse}` : adresse || nom;
            if (label) results.push({ label, ...(p.name && adresse ? { detail: [p.district, p.state, p.country].filter(Boolean).join(", ") } : {}) });
          }
        }
      } catch {
        // La recherche principale reste utilisable si Photon est indisponible.
      }
    }
    const uniques = new Set<string>();
    return NextResponse.json({ results: results.filter((item) => {
      const key = item.label.toLocaleLowerCase("fr-FR");
      if (!key || uniques.has(key)) return false;
      uniques.add(key);
      return true;
    }).slice(0, 8) });
  } catch {
    return NextResponse.json({ results: [] });
  }
}

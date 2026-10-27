import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { PAGES_PUBLIQUES, SITE_URL } from "@/lib/site";
import { normaliserHote, typeHote, urlSitePourHote } from "@/lib/domaines/routage";

/** godac.fr : URLs godac.fr. godac.app : vide (la vitrine fait foi sur godac.fr). Autres hôtes : historique. */
export default function sitemap(): MetadataRoute.Sitemap {
  const h = headers();
  const hote = normaliserHote(h.get("host"), h.get("x-forwarded-host"));
  if (typeHote(hote) === "app") return [];
  const base = urlSitePourHote(hote, SITE_URL);
  return PAGES_PUBLIQUES.map((p) => ({
    url: `${base}${p.path === "/" ? "" : p.path}`,
    changeFrequency: p.priority >= 0.8 ? "weekly" : "monthly",
    priority: p.priority,
  }));
}

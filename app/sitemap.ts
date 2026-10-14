import type { MetadataRoute } from "next";
import { PAGES_PUBLIQUES, SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES_PUBLIQUES.map((p) => ({
    url: `${SITE_URL}${p.path === "/" ? "" : p.path}`,
    changeFrequency: p.priority >= 0.8 ? "weekly" : "monthly",
    priority: p.priority,
  }));
}

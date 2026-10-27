import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { SITE_URL } from "@/lib/site";
import { VITRINE_PATHS, normaliserHote, typeHote, urlSitePourHote } from "@/lib/domaines/routage";

const INTERDITS_APP = ["/api/", "/dashboard", "/admin", "/onboarding", "/driver-pin", "/join", "/scan", "/livreur", "/demo", "/godac-staff", "/prestataire"];

/**
 * Selon l'hôte :
 *  - godac.fr : vitrine indexable, sitemap de godac.fr ; l'application et l'API ne sont jamais explorées.
 *  - godac.app : rien n'est exploré, sauf les pages publiques de la vitrine (leur canonique, en-tête
 *    Link posé par le middleware, pointe sur godac.fr) ; pas de sitemap : c'est celui de godac.fr qui fait foi.
 *  - autres hôtes (godac-v2.vercel.app, previews) : règles historiques, inchangées.
 */
export default function robots(): MetadataRoute.Robots {
  const h = headers();
  const hote = normaliserHote(h.get("host"), h.get("x-forwarded-host"));
  const type = typeHote(hote);
  const pagesPubliques = [...VITRINE_PATHS];

  if (type === "app") {
    return {
      rules: { userAgent: "*", allow: pagesPubliques.filter((p) => p !== "/"), disallow: "/" },
    };
  }

  const base = urlSitePourHote(hote, SITE_URL);
  return {
    rules: { userAgent: "*", allow: pagesPubliques, disallow: INTERDITS_APP },
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}

import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/** Seules les pages publiques sont explorées ; l'application et l'API ne le sont jamais. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/modules", "/contact", "/bon-de-commande", "/cgv", "/cgu", "/sla", "/dpa", "/confidentialite", "/mentions-legales"],
      disallow: ["/api/", "/dashboard", "/admin", "/onboarding", "/driver-pin", "/join", "/scan", "/livreur", "/demo", "/godac-staff", "/prestataire"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}

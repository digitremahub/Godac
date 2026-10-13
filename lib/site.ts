/** Adresse publique du site (liens absolus : sitemap, robots, métadonnées). */
export const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://godac.app").replace(/\/$/, "");

/** Pages publiques indexables, avec leur priorité dans le sitemap. */
export const PAGES_PUBLIQUES: { path: string; priority: number }[] = [
  { path: "/", priority: 1 },
  { path: "/modules", priority: 0.9 },
  { path: "/contact", priority: 0.8 },
  { path: "/bon-de-commande", priority: 0.5 },
  { path: "/cgv", priority: 0.3 },
  { path: "/cgu", priority: 0.3 },
  { path: "/sla", priority: 0.3 },
  { path: "/dpa", priority: 0.3 },
  { path: "/confidentialite", priority: 0.3 },
  { path: "/mentions-legales", priority: 0.2 },
];

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    // Identité stable de l'application installée : sans `id` ni `scope`,
    // certains navigateurs traitent chaque lancement comme une nouvelle page.
    id: "/",
    scope: "/",
    name: "GODAC — Gestion carburant et flotte",
    short_name: "GODAC",
    description: "Gestion carburant, flotte, tournées et entretien pour le transport routier.",
    start_url: "/dashboard",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    background_color: "#F6F7FB",
    theme_color: "#0A0F1E",
    // Raccourci ou icône cliqué alors que GODAC est déjà ouvert : on réutilise
    // la fenêtre existante au lieu d'en ouvrir une nouvelle (Chrome / Edge).
    ...({ launch_handler: { client_mode: ["navigate-existing", "auto"] } } as unknown as Partial<MetadataRoute.Manifest>),
    // Appui long sur l'icône GODAC : accès direct à l'application chauffeur.
    shortcuts: [{ name: "Ma tournée colis", short_name: "Colis", url: "/livreur", icons: [{ src: "/brand/app-icon-192.png", sizes: "192x192" }] }],
    icons: [
      { src: "/brand/app-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

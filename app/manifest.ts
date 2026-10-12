import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GODAC — Gestion carburant et flotte",
    short_name: "GODAC",
    description: "Gestion carburant, flotte, tournées et entretien pour le transport routier.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#F6F7FB",
    theme_color: "#0A0F1E",
    icons: [
      { src: "/brand/app-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

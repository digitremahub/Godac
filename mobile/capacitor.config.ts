import type { CapacitorConfig } from "@capacitor/cli";

/**
 * GODAC Livreur : l'application des stores ouvre l'application chauffeur
 * en ligne (/livreur). Chaque mise à jour du site est donc aussitôt dans
 * l'application, sans repasser par la validation Apple / Google.
 * GODAC_URL permet de pointer vers un autre domaine (préproduction).
 */
const site = process.env.GODAC_URL ?? "https://godac.app";
const hote = new URL(site).hostname;

const config: CapacitorConfig = {
  appId: "fr.godac.livreur",
  appName: "GODAC Livreur",
  // Page embarquée affichée seulement si le site est injoignable (pas de réseau).
  webDir: "www",
  server: {
    url: `${site}/livreur`,
    hostname: hote,
    androidScheme: "https",
    allowNavigation: [hote, "*.supabase.co"],
    errorPath: "offline.html",
  },
  backgroundColor: "#0A0F1E",
  ios: { contentInset: "never", limitsNavigationsToAppBoundDomains: false },
  android: { allowMixedContent: false },
  plugins: {
    SplashScreen: { launchShowDuration: 800, backgroundColor: "#0A0F1E", showSpinner: false },
    StatusBar: { style: "DARK", backgroundColor: "#0A0F1E", overlaysWebView: false },
  },
};

export default config;

import { readFileSync } from "node:fs";

/**
 * Anciennes adresses → nouvelles adresses par section (plan de
 * réorganisation, § 4). Liste dans config/redirections.json, vérifiée par
 * lib/acces/__tests__/redirections.test.ts. Temporaires (307) pendant le
 * premier mois, puis permanentes ; à conserver au moins 13 mois (e-mails,
 * notifications push, favoris). La chaîne de requête est transmise.
 */
const REDIRECTIONS = JSON.parse(readFileSync(new URL("./config/redirections.json", import.meta.url), "utf8"));

/** @type {import('next').NextConfig} */
const SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://*.supabase.co";
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://js.stripe.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co https://tiles.openfreemap.org https://*.openfreemap.org",
  "font-src 'self' data:",
  `connect-src 'self' ${SUPABASE} wss://*.supabase.co https://*.supabase.co https://tiles.openfreemap.org https://*.openfreemap.org`,
  "worker-src 'self' blob:",
  "frame-src https://js.stripe.com https://checkout.stripe.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://checkout.stripe.com",
  "object-src 'none'",
  "report-uri /api/csp-report",
].join("; ");

const nextConfig = {
  reactStrictMode: true,
  // lib/assistant/help-content.ts reads content/help/*.md via a
  // runtime-built path (the filename comes from a data array, not a
  // string literal at the fs.readFileSync call site) — Next's static
  // file tracing can't follow that, so the directory is force-included
  // for the one route that needs it at runtime (Vercel).
  experimental: {
    outputFileTracingIncludes: {
      "/api/assistant/message": ["./content/help/**"],
    // @react-pdf/renderer ALWAYS touches pdfkit's built-in "Helvetica"
    // standard font, no matter what font our own styles request:
    // @react-pdf/font eagerly pre-loads it the moment the library is
    // imported, and @react-pdf/layout's getFragments() unconditionally
    // appends "Helvetica" as a fallback family for every single text
    // run. pdfkit loads it via `require('#standard-fonts/Helvetica')`
    // — a Node "imports" subpath, resolved through a renamed `require$1`
    // binding — which Next's static file tracing can't follow, and
    // outputFileTracingIncludes can't rescue either: tested directly
    // (both a literal node_modules path and a glob over the whole
    // standard-fonts/ and data/ directories), every one of those files
    // gets silently dropped from the trace, unlike a project-root path
    // (see content/help above, and assets/fonts/** below, which DO
    // trace correctly). patches/pdfkit+*.patch (see patch-package,
    // "postinstall" script) repoints pdfkit's Helvetica loader at
    // assets/pdfkit-standard-fonts/ — a vendored copy of the same 4
    // files, now a project-root path like any other — so this entry
    // just makes sure that copy (and the embedded NotoSans font the
    // generators actually ask for) gets traced.
      "/api/payslips/generate": ["./assets/fonts/**", "./assets/pdfkit-standard-fonts/**"],
      // Bulletins de paie (lib/paie/pdf.tsx) : génération, et bulletin
      // validé de la démo (lib/demo/seed-modules.ts), reconstruit par le
      // cron nocturne ou au premier « Voir la démo ».
      "/api/paie/bulletins": ["./assets/fonts/**", "./assets/pdfkit-standard-fonts/**"],
      // Journal de paie et registre du personnel (lib/paie/pdf-registres.tsx).
      "/api/paie/export": ["./assets/fonts/**", "./assets/pdfkit-standard-fonts/**"],
      "/api/exploitation/export": ["./assets/fonts/**", "./assets/pdfkit-standard-fonts/**"],
      "/api/paie/registre": ["./assets/fonts/**", "./assets/pdfkit-standard-fonts/**"],
      "/api/cron/reset-demo": ["./assets/fonts/**", "./assets/pdfkit-standard-fonts/**"],
      "/demo": ["./assets/fonts/**", "./assets/pdfkit-standard-fonts/**"],
      "/api/ticpe/export": ["./assets/fonts/**", "./assets/pdfkit-standard-fonts/**"],
      "/api/ticpe/export-lines/[id]": ["./assets/fonts/**", "./assets/pdfkit-standard-fonts/**"],
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
    ],
  },
  async redirects() {
    return REDIRECTIONS.map((r) => ({ source: r.source, destination: r.destination, permanent: false, ...(r.has ? { has: r.has } : {}) }));
  },
  async headers() {
    return [
      {
        // Lecteur de codes-barres (ZXing, 1 Mo) : nom de fichier stable, donc revalidé chaque semaine plutôt que « immutable ».
        source: "/zxing/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=2592000" }],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Camera and geolocation stay available to this site itself
          // (QR scan, photos ; pointage géolocalisé, pointage assisté,
          // position sur la carte de tournée) — every other origin is
          // denied. geolocation=() used to block the GPS badge entirely.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self)" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          // Politique de contenu en mode « rapport seul » : rien n'est bloqué,
          // les écarts sont remontés à /api/csp-report pour l'ajuster avant
          // de la rendre bloquante (audit sécurité).
          { key: "Content-Security-Policy-Report-Only", value: CSP },
        ],
      },
    ];
  },
};

export default nextConfig;

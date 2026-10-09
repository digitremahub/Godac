/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // lib/assistant/help-content.ts reads content/help/*.md via a
  // runtime-built path (the filename comes from a data array, not a
  // string literal at the fs.readFileSync call site) — Next's static
  // file tracing can't follow that, so the directory is force-included
  // for the one route that needs it at runtime (Vercel).
  outputFileTracingIncludes: {
    "/api/assistant/message": ["./content/help/**"],
    // @react-pdf/renderer's PDF generation goes through pdfkit, which
    // requires its standard-font data files (js/standard-fonts/*,
    // js/data/*.afm) at runtime from a dynamically-built path Next's
    // static file tracing can't follow. outputFileTracingIncludes
    // can't rescue this either — tested directly: even a single,
    // non-glob node_modules path given here is silently dropped from
    // the trace, unlike a project-root path (see content/help above).
    // The actual fix is lib/payslips/generate-pdf.tsx and
    // lib/ticpe/generate-pdf.tsx registering their own embedded font
    // from assets/fonts/ instead of ever touching pdfkit's standard
    // fonts — this entry just makes sure that font file is traced.
    "/api/payslips/generate": ["./assets/fonts/**"],
    "/api/ticpe/export": ["./assets/fonts/**"],
    "/api/ticpe/export-lines/[id]": ["./assets/fonts/**"],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Camera stays available to this site itself (QR scan,
          // counter-photo capture) — every other origin is denied.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;

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
    "/api/ticpe/export": ["./assets/fonts/**", "./assets/pdfkit-standard-fonts/**"],
    "/api/ticpe/export-lines/[id]": ["./assets/fonts/**", "./assets/pdfkit-standard-fonts/**"],
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

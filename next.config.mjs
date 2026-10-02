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

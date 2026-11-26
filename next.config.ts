import type { NextConfig } from "next";

const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseOrigin = supabase ? new URL(supabase).origin : "";
const supabaseSocket = supabaseOrigin.replace(/^http/, "ws");
const dev = process.env.NODE_ENV !== "production";

// What the page may load. Scripts and styles need 'unsafe-inline' because
// Next.js adds small inline scripts to every page; everything else is limited
// to this site and Supabase.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self' ${supabaseOrigin} ${supabaseSocket}`.trim(),
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // No other site may show the app in a frame (stops clickjacking).
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

// The GitHub Pages preview (npm run build:pages) is a static export served
// from a sub-path. Static hosting can't send headers, so those are left out.
const staticPreview = process.env.NEXT_PUBLIC_STATIC_PREVIEW === "true";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const previewConfig: NextConfig = {
  output: "export",
  basePath: basePath || undefined,
  // Saves each page as folder/index.html, which GitHub Pages serves at /folder/.
  trailingSlash: true,
  images: { unoptimized: true },
};

const nextConfig: NextConfig = staticPreview
  ? { poweredByHeader: false, ...previewConfig }
  : {
      poweredByHeader: false,
      headers,
    };

async function headers() {
  return [
    { source: "/:path*", headers: securityHeaders },
    {
      // Always check for a new service worker, so updates reach phones.
      source: "/sw.js",
      headers: [{ key: "Cache-Control", value: "no-cache" }],
    },
  ];
}

export default nextConfig;

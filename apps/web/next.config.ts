import type { NextConfig } from "next";

/**
 * Security headers for every page. The app is never meant to be framed, so
 * framing is refused outright (blocks clickjacking, e.g. a hidden frame that
 * tricks someone into "Connect Gmail" or "Delete workspace"). The CSP is
 * deliberately limited to directives that can't break the app (no
 * script-src: Next inlines bootstrap scripts and the theme init).
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Reset links carry a token: other sites only ever see our origin.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // Ignored over plain http (local dev); enforces https once deployed.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

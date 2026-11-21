import path from "path";
import type { NextConfig } from "next";

/**
 * Hosted build (Dockerfile): NEXT_OUTPUT=standalone produces a self-contained
 * server, and API_PROXY_TARGET makes /api/* on this origin proxy to the API.
 * Same-origin REST means the refresh cookie is first-party even though web
 * and API live on different hosts (two *.run.app hosts are cross-site, and
 * Safari blocks cross-site cookies). Both are build-time; unset locally.
 */
const standalone = process.env.NEXT_OUTPUT === "standalone";
const apiProxy = process.env.API_PROXY_TARGET?.replace(/\/$/, "");

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
  ...(standalone && {
    output: "standalone",
    // monorepo: trace dependencies from the repo root
    outputFileTracingRoot: path.join(__dirname, "../.."),
  }),
  async rewrites() {
    return apiProxy ? [{ source: "/api/:path*", destination: `${apiProxy}/:path*` }] : [];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

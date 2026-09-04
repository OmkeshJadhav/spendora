import type { NextConfig } from "next";

/**
 * Response headers that hold for every route (specification section 32).
 *
 * These are the protections a browser can only apply if it is told to, and
 * none of them is derivable from the page itself — so they belong here rather
 * than in any one route.
 *
 * Deliberately not a full Content-Security-Policy: a useful one for this app
 * needs a per-request nonce for Next's inline bootstrap scripts, which is a
 * proxy concern rather than a static header, and a `script-src` that is wrong
 * is worse than none — it either breaks the application or lulls with
 * `unsafe-inline`. `frame-ancestors` is the half that works as a constant, so
 * that is the half stated, alongside its older equivalent for browsers that
 * still honour it.
 */
const securityHeaders = [
  // Clickjacking. Every destructive control in the application is a plain POST
  // form — delete a group, remove a member, delete an expense — so a page that
  // could be framed is a page whose buttons can be borrowed.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  // A CSV export is served as text/csv and an XLSX as a binary type. Without
  // this a browser is free to sniff past the declared type and render one.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Export links carry the filters in force in their query string, and a
  // filter can be a search term. `strict-origin-when-cross-origin` keeps the
  // path off any request that leaves the origin.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nothing here uses these, so nothing here — or anything embedded by
  // accident — should be able to ask for them.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  // Session cookies and exported spending must never travel in the clear.
  // Browsers ignore this over plain HTTP, so it costs development nothing.
  // No `includeSubDomains`: this application does not own its siblings.
  { key: "Strict-Transport-Security", value: "max-age=63072000" },
];

const nextConfig: NextConfig = {
  // The framework and its version are not the browser's business.
  poweredByHeader: false,

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

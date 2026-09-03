import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // app/globals.css and app/portal.css are one stylesheet cut in two, and the
  // portal's cascade only reproduces the original if globals loads first.
  //
  // `experimental.cssChunking: "strict"` would pin that, but it is webpack-only
  // and Next 16.3.1 hard-errors on it under Turbopack, which is what this
  // project builds with. It is also not needed: the root layout imports
  // globals.css and is an ancestor segment of the eight layouts that import
  // portal.css, so the App Router emits the parent's stylesheet first. Verified
  // against a real production build -- /login links globals (the chunk carrying
  // Preflight and :root) ahead of portal (the chunk carrying .coach-slot-day).
  //
  // If that order ever inverts, the symptom is portal rules losing to globals
  // rules they used to beat. tests/portal-stylesheet-split.test.ts holds the
  // import side of the invariant; the accessibility suite is what would catch
  // the visual half.

  // PDFKit reads its built-in AFM font files at runtime. Keeping the package
  // external preserves those files at their real node_modules paths instead
  // of rewriting them into the Next.js server bundle.
  serverExternalPackages: ["libsql", "pdfkit"],

  /*
   * No response carried a single security header before this -- not the sign-in
   * page, not the coach workspace. These are the cheap half of defence in depth:
   * they do not fix a bug, they narrow what a bug could become.
   *
   * frame-ancestors 'none' is the one that matters most here: without it any
   * site could frame the portal and trick a signed-in coach into clicking
   * through an approval or a fee change.
   *
   * The CSP is deliberately report-friendly rather than strict-dynamic: Next
   * injects inline bootstrap scripts, so 'unsafe-inline' stays for now. Tighten
   * it with a nonce once there is a report endpoint to prove nothing breaks.
   */
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "same-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains",
        },
        {
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            "base-uri 'self'",
            "object-src 'none'",
            "frame-ancestors 'none'",
            "form-action 'self'",
            "img-src 'self' data: blob:",
            "style-src 'self' 'unsafe-inline'",
            // 'unsafe-eval' in development only. React's dev build uses eval()
            // to rebuild callstacks across the server/client boundary, so
            // without it every page logs "eval() is not supported in this
            // environment" and the debugging features stop working. It is never
            // sent in production, which is the build that matters here.
            process.env.NODE_ENV === "production"
              ? "script-src 'self' 'unsafe-inline'"
              : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
            "connect-src 'self'",
            "font-src 'self' data:",
          ].join("; "),
        },
      ],
    }]
  },

  // No `outputFileTracingIncludes` for ./drizzle/**. The only thing that reads a
  // migration is `prepareDatabase` in lib/db/setup.ts, whose own comment says
  // "Deployment, development and test setup only. Request code must use
  // initializeDatabase(), which opens the prepared database without writing to
  // it." Its single importer is scripts/database/prepare.ts, which `vercel-build`
  // runs *before* `next build`, in the build container where the checkout is
  // already on disk -- tracing decides what is copied into the function output,
  // not what the build step can see.
  //
  // So the include was copying 3.0 MB of SQL and metadata into all 67 route
  // bundles for code no request can reach. Measured before removal: 3,886 entries
  // across the .nft.json manifests referenced drizzle/.
  //
  // If a runtime path ever does need to migrate, this has to come back -- and the
  // failure mode is a route throwing on a missing migrations folder, not a build
  // error, so the check belongs with whatever adds that path.
}

export default nextConfig

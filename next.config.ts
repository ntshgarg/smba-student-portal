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

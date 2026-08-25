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
  outputFileTracingIncludes: {
    "/*": ["./drizzle/**/*"],
  },
}

export default nextConfig

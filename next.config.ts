import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // app/globals.css and app/portal.css are one stylesheet cut in two, and the
  // portal's cascade only reproduces the original if globals loads first. The
  // default "loose" chunking *guesses* dependencies between CSS files to keep
  // their order; nothing links these two beyond the root layout being an
  // ancestor segment of the layouts that import portal.css, so a guess is not
  // a guarantee. 'strict' keeps import order at the cost of more requests.
  experimental: {
    cssChunking: "strict",
  },
  // PDFKit reads its built-in AFM font files at runtime. Keeping the package
  // external preserves those files at their real node_modules paths instead
  // of rewriting them into the Next.js server bundle.
  serverExternalPackages: ["libsql", "pdfkit"],
  outputFileTracingIncludes: {
    "/*": ["./drizzle/**/*"],
  },
}

export default nextConfig

import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // PDFKit reads its built-in AFM font files at runtime. Keeping the package
  // external preserves those files at their real node_modules paths instead
  // of rewriting them into the Next.js server bundle.
  serverExternalPackages: ["pdfkit"],
}

export default nextConfig

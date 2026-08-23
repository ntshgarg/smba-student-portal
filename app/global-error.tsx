"use client"

import { RouteErrorState } from "@/components/route-recovery"

import "./globals.css"

// The root layout does not render behind this boundary, so the next/font variables it
// normally sets on <body> are absent and every globals.css font-family would be invalid.
const rootFontFallback = ":root{"
  + "--font-manrope:system-ui,-apple-system,\"Segoe UI\",Roboto,Arial,sans-serif;"
  + "--font-newsreader:Georgia,\"Times New Roman\",serif"
  + "}"

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <style>{rootFontFallback}</style>
        <RouteErrorState
          body="Try loading it again. If the problem continues, return to the academy homepage."
          eyebrow="SMBA portal"
          onRetry={reset}
          returnHref="/"
          returnLabel="Return to academy"
          title="The portal could not start."
        />
      </body>
    </html>
  )
}

"use client"

import { RouteErrorState } from "@/components/route-recovery"
import { useErrorReport } from "@/lib/telemetry/use-error-report"

import "./globals.css"

// The root layout does not render behind this boundary, so the next/font variables it
// normally sets on <body> are absent and every globals.css font-family would be invalid.
const rootFontFallback = ":root{"
  + "--font-manrope:system-ui,-apple-system,\"Segoe UI\",Roboto,Arial,sans-serif;"
  + "--font-newsreader:Georgia,\"Times New Roman\",serif"
  + "}"

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  // Safe here because useErrorReport reaches nothing beyond React and two
  // dependency-free modules. This boundary renders when the root layout has
  // already failed, so it cannot rely on the database, fonts or a provider.
  useErrorReport("global", error)

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

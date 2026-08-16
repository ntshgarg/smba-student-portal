import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

function relativeLuminance(hex: string) {
  const channels = hex.match(/[0-9a-f]{2}/giu)?.map((channel) => (
    Number.parseInt(channel, 16) / 255
  )) ?? []
  const [red = 0, green = 0, blue = 0] = channels.map((channel) => (
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  ))
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrastRatio(first: string, second: string) {
  const values = [relativeLuminance(first), relativeLuminance(second)]
    .sort((left, right) => right - left)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

describe("Phase 3 accessibility corrections", () => {
  it("keeps public navigation disclosures semantically accurate", () => {
    const header = source("components/public/public-header.tsx")

    expect(header).not.toContain("aria-haspopup")
    expect(header).toContain("aria-expanded={accountOpen}")
    expect(header).toContain('aria-controls={accountOpen ? "header-account-menu" : undefined}')
    expect(header).toContain("aria-expanded={open}")
    expect(header).toContain('aria-controls={open ? "mobile-navigation" : undefined}')
  })

  it("uses sequential headings in populated report and attendance views", () => {
    const reports = source("components/reports/report-accordion.tsx")
    const register = source("components/coach/player-attendance-register.tsx")

    expect(reports).toContain("<h2>")
    expect(reports).toContain("<h3>")
    expect(reports).not.toContain("<h4>")
    expect(register).toContain("<h2>{selectedProgramme} · {selectedBatch}</h2>")
    expect(register).not.toContain("<h3>{selectedProgramme} · {selectedBatch}</h3>")
  })

  it("keeps unavailable register labels muted while meeting text contrast", () => {
    const background = "#f0efec"
    const styles = source("app/globals.css")
    const steel = styles.match(/--steel:\s*(#[0-9a-f]{6})/iu)?.[1]
    const unavailableRule = styles.match(
      /\.coach-register-table \.coach-register-date-row th\.is-unavailable \{([^}]*)\}/u,
    )?.[1]
    const dateRule = styles.match(
      /\.coach-register-table \.coach-register-date-row th\.is-unavailable > strong \{([^}]*)\}/u,
    )?.[1]

    expect(steel).toBeDefined()
    expect(contrastRatio(steel ?? "#000000", background)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio("#45515b", background)).toBeGreaterThanOrEqual(4.5)
    expect(unavailableRule).toContain("color: var(--steel)")
    expect(dateRule).toContain("color: #45515b")
  })
})

import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

// The register and legend rules these assertions pin are portal-only, so they live
// in app/portal.css since the boundary redraw; the tokens they read live in
// app/globals.css. Both stylesheets load on every authenticated route, globals
// first, so concatenating them in that order is what the browser resolves and
// keeps the assertions indifferent to which side a rule sits on. Same idiom as
// tests/accessibility-hardening.test.ts.
function portalStyles() {
  return source("app/globals.css") + source("app/portal.css")
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

  it("uses sequential headings in the populated attendance view", () => {
    const register = source("components/coach/player-attendance-register.tsx")

    expect(register).toContain("<h2>{selectedProgramme} · {selectedBatch}</h2>")
    expect(register).not.toContain("<h3>{selectedProgramme} · {selectedBatch}</h3>")
  })

  it("gives the register tiles a mark per attendance state, not colour alone", () => {
    const playerRegister = source("components/coach/player-attendance-register.tsx")
    const staffRegister = source("components/coach/staff-attendance-register.tsx")
    const chrome = source("components/coach/attendance-register-chrome.tsx")
    const tiles = source("components/coach/attendance-register.module.css")
    const styles = portalStyles()
    const green = styles.match(/--green:\s*(#[0-9a-f]{6})/iu)?.[1]
    const red = styles.match(/--red:\s*(#[0-9a-f]{6})/iu)?.[1]

    // The two fills the tiles rely on are all but identical in greyscale,
    // which is what a phone in courtside glare renders.
    expect(contrastRatio(green ?? "#000000", red ?? "#ffffff")).toBeLessThan(1.5)

    // Absent carries a corner cross and a make-up a corner arrow; present is
    // the only solid tile with no mark, and "not recorded" is hatched.
    expect(chrome).toContain('if (kind === "absent") return <X aria-hidden="true" className={styles.corner} />')
    expect(chrome).toContain('if (kind === "makeup") return <RefreshCw aria-hidden="true" className={styles.corner} />')
    expect(chrome).toContain('if (kind === "holiday") return <CalendarOff aria-hidden="true" />')
    expect(tiles).toMatch(/\.unmarked \{[^}]*repeating-linear-gradient/u)
    for (const register of [playerRegister, staffRegister]) {
      expect(register).toContain("<TileMark kind=")
      expect(register).toContain('role="img"')
    }
    // The key draws the same marks the grid does.
    expect(chrome).toContain("<TileMark kind={item} />")
  })

  it("keeps unavailable register labels muted while meeting text contrast", () => {
    const background = "#f0efec"
    const styles = portalStyles()
    const tiles = source("components/coach/attendance-register.module.css")
    const steel = styles.match(/--steel:\s*(#[0-9a-f]{6})/iu)?.[1]
    const unavailableRule = tiles.match(/\.table thead th \{([^}]*)\}/u)?.[1]
    const dateRule = tiles.match(/\.table thead th\[data-unavailable\] > strong \{([^}]*)\}/u)?.[1]

    expect(steel).toBeDefined()
    expect(contrastRatio(steel ?? "#000000", background)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio("#45515b", background)).toBeGreaterThanOrEqual(4.5)
    expect(unavailableRule).toContain("color: var(--steel)")
    expect(dateRule).toContain("color: #45515b")
  })
})

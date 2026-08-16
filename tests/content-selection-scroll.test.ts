import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

function source(file: string) {
  return readFileSync(path.join(process.cwd(), file), "utf8")
}

describe("content selection focus", () => {
  it("does not move the viewport when onboarding opens a player editor", () => {
    const onboarding = source("components/coach/onboarding/player-onboarding-register.tsx")

    expect(onboarding).toMatch(
      /onboarding-editor-title-\$\{selectedItem\.id\}`\)\?\.focus\(\{\s+preventScroll: true,?\s+\}\)/u,
    )
  })

  it("does not move the viewport when guided roster content receives focus", () => {
    const schedules = source("components/coach/calendar/session-schedules.tsx")

    expect(schedules).toContain("guidanceHeadingRef.current?.focus({ preventScroll: true })")
  })

  it("does not move the viewport when more published reports are revealed", () => {
    const reports = source("components/coach/reports/published-reports-list.tsx")

    expect(reports).toContain("firstNewReportRef.current?.focus({ preventScroll: true })")
  })
})

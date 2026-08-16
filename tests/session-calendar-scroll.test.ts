import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

describe("Session Calendar date navigation", () => {
  it("hands focus to Day View without moving the page scroll position", () => {
    const calendar = readFileSync(path.join(
      process.cwd(),
      "components/coach/calendar/session-calendar.tsx",
    ), "utf8")

    expect(calendar).toContain("dayHeadingRef.current?.focus({ preventScroll: true })")
    expect(calendar).toContain("{ scroll: false }")
  })
})

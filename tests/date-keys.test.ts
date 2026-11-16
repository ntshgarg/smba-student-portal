import { describe, expect, it } from "vitest"

import { shiftDateKey } from "@/lib/date-keys"

describe("shiftDateKey", () => {
  it("moves a date key by whole days across month and year ends", () => {
    expect(shiftDateKey("2026-11-16", 6)).toBe("2026-11-22")
    expect(shiftDateKey("2026-12-31", 1)).toBe("2027-01-01")
    expect(shiftDateKey("2027-03-01", -1)).toBe("2027-02-28")
  })
})

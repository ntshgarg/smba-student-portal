import { describe, expect, it } from "vitest"

import {
  getAttendanceRegisterWindow,
  getInitialAttendanceRegisterWindow,
} from "@/components/coach/use-attendance-register-window"

describe("annual attendance register window", () => {
  it("mounts a bounded opening window that includes its anchor", () => {
    const window = getInitialAttendanceRegisterWindow(365, 221)

    expect(window.start).toBeLessThanOrEqual(221)
    expect(window.end).toBeGreaterThan(221)
    expect(window.end - window.start).toBeLessThanOrEqual(16)
  })

  it("keeps the opening and closing edges inside the annual range", () => {
    expect(getInitialAttendanceRegisterWindow(365, 0)).toEqual({ start: 0, end: 12 })
    expect(getInitialAttendanceRegisterWindow(365, 364)).toEqual({ start: 360, end: 365 })
  })

  it("tracks a scrolled desktop viewport with bounded overscan", () => {
    const window = getAttendanceRegisterWindow({
      dateCount: 365,
      dateWidth: 58,
      nameWidth: 250,
      scrollLeft: 200 * 58,
      viewportWidth: 1024,
    })

    expect(window.start).toBe(196)
    expect(window.end).toBe(219)
    expect(window.end - window.start).toBeLessThan(30)
  })

  it("clamps the rendered window at the end of the year", () => {
    const window = getAttendanceRegisterWindow({
      dateCount: 365,
      dateWidth: 54,
      nameWidth: 148,
      scrollLeft: 400 * 54,
      viewportWidth: 390,
    })

    expect(window.end).toBe(365)
    expect(window.start).toBe(360)
  })
})

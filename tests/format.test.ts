import { describe, expect, it } from "vitest"

import {
  ACADEMY_TIME_ZONE,
  academyTimeInputValue,
  formatDateKey,
  formatInr,
  formatSessionLabel,
  formatSessionLabelFromInstant,
  formatSessionTimeRange,
  getAcademyDateKey,
  getAcademyMonthKey,
} from "@/lib/format"

describe("academy presentation helpers", () => {
  it("uses the academy timezone for calendar keys at the India day boundary", () => {
    const instant = new Date("2026-08-01T18:45:00.000Z")

    expect(ACADEMY_TIME_ZONE).toBe("Asia/Kolkata")
    expect(getAcademyDateKey(instant)).toBe("2026-08-02")
    expect(getAcademyMonthKey(instant)).toBe("2026-08")
    expect(academyTimeInputValue(instant)).toBe("00:15")
  })

  it("keeps date-only keys stable instead of treating them as instants", () => {
    expect(formatDateKey("2026-08-02", {
      day: "2-digit",
      month: "2-digit",
      weekday: undefined,
      year: "numeric",
    })).toBe("02/08/2026")
  })

  it("prints whole rupees bare and part-rupee amounts to the paisa", () => {
    expect(formatInr(100_000)).toBe("₹1,000")
    expect(formatInr(123_456)).toBe("₹1,234.56")
    /* Half-rupee amounts are where a `maximumFractionDigits: 0` formatter
       rounds half-expand and overstates what a parent owes: this was `₹1`. */
    expect(formatInr(50)).toBe("₹0.50")
    expect(formatInr(0)).toBe("₹0")
    expect(formatInr(-12_345)).toBe("-₹123.45")
  })

  it("formats human session labels without changing stored session names", () => {
    expect(formatSessionLabel({
      programme: "Adult",
      batch: "Weekday",
      startTime: "18:00",
      durationMinutes: 60,
    })).toBe("Adult · Weekday · 6–7 pm")

    expect(formatSessionLabel({
      programme: "Intermediate",
      batch: "Weekday",
      startTime: "11:30",
      durationMinutes: 60,
    })).toBe("Intermediate · Weekday · 11:30 am–12:30 pm")

    expect(formatSessionTimeRange({
      startTime: "18:00",
      durationMinutes: 60,
    })).toBe("6–7 pm")

    expect(formatSessionLabelFromInstant({
      programme: "Beginner",
      batch: "Weekday",
      startsAt: "2026-08-10T00:30:00.000Z",
      durationMinutes: 60,
    })).toBe("Beginner · Weekday · 6–7 am")
  })

  it("falls back to session context when time data cannot be presented", () => {
    expect(formatSessionLabel({
      programme: "Beginner",
      batch: "Weekend",
      startTime: "",
      durationMinutes: 0,
    })).toBe("Beginner · Weekend")
  })
})

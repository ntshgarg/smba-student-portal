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
  getAcademyMonthKey, parseRupeesToPaise } from "@/lib/format"

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

describe("parseRupeesToPaise", () => {
  /*
   * The onboarding fee field used `type="number" min="1" step="1"` and left the
   * refusal to the browser, so these amounts never reached the product's own
   * message. They are pinned here because that field now depends on this
   * function to refuse them.
   */
  it("accepts the amounts a coach can type, including the grouped placeholder", () => {
    expect(parseRupeesToPaise("3500")).toBe(350_000)
    expect(parseRupeesToPaise("3,500")).toBe(350_000)
    expect(parseRupeesToPaise(" 3,500 ")).toBe(350_000)
    expect(parseRupeesToPaise("3500.5")).toBe(350_050)
    expect(parseRupeesToPaise("3500.55")).toBe(350_055)
  })

  it("refuses fractions finer than paise, zero and negatives", () => {
    expect(parseRupeesToPaise("3500.555")).toBeNull()
    expect(parseRupeesToPaise("-100")).toBeNull()
    expect(parseRupeesToPaise("0")).toBeNull()
    expect(parseRupeesToPaise("")).toBeNull()
    expect(parseRupeesToPaise("free")).toBeNull()
    expect(parseRupeesToPaise("1e3")).toBeNull()
  })

  it("admits zero only where a caller allows it", () => {
    expect(parseRupeesToPaise("0", true)).toBe(0)
  })
})

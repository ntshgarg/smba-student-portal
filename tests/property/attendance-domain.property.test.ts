import fc from "fast-check"
import { describe, expect, it } from "vitest"

import {
  calculateMonthlyAttendance,
  createAttendanceSnapshotV4,
  parseAttendanceSnapshot,
  type MonthlyAttendanceInput,
} from "@/lib/attendance/domain"

const PROPERTY_RUNS = 200
const REFERENCE_INSTANT = "2026-09-01T00:00:00.000Z"

type GeneratedAttendance = {
  choice: "absent" | "pending" | "present"
  reconcile: boolean
}

const attendanceMonthArbitrary = fc.array(fc.record({
  choice: fc.constantFrom<GeneratedAttendance["choice"]>("present", "absent", "pending"),
  reconcile: fc.boolean(),
}), {
  minLength: 1,
  maxLength: 28,
})

function attendanceInput(
  generated: GeneratedAttendance[],
  includeAdjustments: boolean,
): MonthlyAttendanceInput & { referenceInstant: string } {
  const occurrences = generated.map((_, index) => {
    const day = String(index + 1).padStart(2, "0")
    return {
      id: `occurrence-${index}`,
      seriesId: "property-series",
      occurrenceDate: `2026-08-${day}`,
      eligibilityDate: `2026-08-${day}`,
      startsAt: `2026-08-${day}T00:30:00.000Z`,
      status: "scheduled" as const,
    }
  })
  const records = generated.flatMap((item, index) => (
    item.choice === "pending"
      ? []
      : [{ occurrenceId: `occurrence-${index}`, choice: item.choice }]
  ))
  const adjustments = includeAdjustments
    ? generated.flatMap((item, index) => (
        item.choice === "absent" && item.reconcile
          ? [{ id: `adjustment-${index}`, sourceOccurrenceId: `occurrence-${index}` }]
          : []
      ))
    : []

  return {
    month: "2026-08",
    referenceDate: "2026-08-31",
    referenceInstant: REFERENCE_INSTANT,
    joinedOn: "2026-08-01",
    assignments: [{
      seriesId: "property-series",
      effectiveFrom: "2026-08-01",
      effectiveTo: null,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
    }],
    occurrences,
    records,
    adjustments,
  }
}

describe("attendance domain properties", () => {
  it("reconciles saved absences without changing the attendance denominator", () => {
    fc.assert(fc.property(attendanceMonthArbitrary, (generated) => {
      const baseInput = attendanceInput(generated, false)
      const reconciledInput = attendanceInput(generated, true)
      const base = calculateMonthlyAttendance(baseInput)
      const reconciled = calculateMonthlyAttendance(reconciledInput)
      const reconciliationCount = generated.filter((item) => (
        item.choice === "absent" && item.reconcile
      )).length

      expect(reconciled.eligible).toBe(base.eligible)
      expect(reconciled.recorded).toBe(base.recorded)
      expect(reconciled.pending).toBe(base.pending)
      expect(reconciled.attended).toBe(base.attended + reconciliationCount)
      expect(reconciled.absent).toBe(base.absent - reconciliationCount)
      expect(reconciled.recorded).toBe(reconciled.attended + reconciled.absent)
      expect(reconciled.eligible).toBe(reconciled.recorded + reconciled.pending)
      expect(reconciled.percentage).toBe(
        reconciled.recorded
          ? Math.round((reconciled.attended / reconciled.recorded) * 100)
          : null,
      )

      const reordered = calculateMonthlyAttendance({
        ...reconciledInput,
        adjustments: [...(reconciledInput.adjustments ?? [])].reverse(),
        assignments: [...reconciledInput.assignments].reverse(),
        occurrences: [...reconciledInput.occurrences].reverse(),
        records: [...reconciledInput.records].reverse(),
      })
      expect(reordered).toEqual(reconciled)

      const snapshot = createAttendanceSnapshotV4(reconciledInput)
      expect(parseAttendanceSnapshot(snapshot)).toEqual(snapshot)
      expect(snapshot.appliedAdjustmentIds).toEqual(
        (reconciledInput.adjustments ?? [])
          .map((adjustment) => adjustment.id)
          .sort((left, right) => left.localeCompare(right)),
      )
      expect(new Set(snapshot.appliedAdjustmentIds).size)
        .toBe(snapshot.appliedAdjustmentIds.length)
    }), { numRuns: PROPERTY_RUNS })
  })
})

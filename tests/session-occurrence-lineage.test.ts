import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { resolveOccurrenceEligibilityDates } from "@/lib/sessions/occurrence-lineage"

type LineageRow = {
  id: string
  seriesId: string
  occurrenceDate: string
  replacementForOccurrenceId: string | null
}

function executorReturning(...responses: LineageRow[][]) {
  let call = 0
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          all: () => responses[call++] ?? [],
        }),
      }),
    }),
  } as never
}

describe("session occurrence lineage", () => {
  it("resolves a replacement chain to the root occurrence outside the requested rows", () => {
    const replacement = {
      id: "replacement-two",
      seriesId: "series",
      occurrenceDate: "2026-08-06",
      replacementForOccurrenceId: "replacement-one",
      label: "preserved",
    }
    const firstReplacement = {
      id: "replacement-one",
      seriesId: "series",
      occurrenceDate: "2026-08-05",
      replacementForOccurrenceId: "source",
    }
    const source = {
      id: "source",
      seriesId: "series",
      occurrenceDate: "2026-08-01",
      replacementForOccurrenceId: null,
    }

    expect(resolveOccurrenceEligibilityDates(
      executorReturning([firstReplacement], [source]),
      [replacement],
    )).toEqual([{ ...replacement, eligibilityDate: "2026-08-01" }])
  })

  it("uses an ordinary occurrence's own date without querying lineage", () => {
    const occurrence = {
      id: "ordinary",
      seriesId: "series",
      occurrenceDate: "2026-08-03",
      replacementForOccurrenceId: null,
    }
    expect(resolveOccurrenceEligibilityDates({} as never, [occurrence]))
      .toEqual([{ ...occurrence, eligibilityDate: occurrence.occurrenceDate }])
  })

  it("rejects incomplete, cyclic, and cross-series lineage", () => {
    const replacement = {
      id: "replacement",
      seriesId: "series",
      occurrenceDate: "2026-08-05",
      replacementForOccurrenceId: "source",
    }
    expect(() => resolveOccurrenceEligibilityDates(executorReturning([]), [replacement]))
      .toThrow("lineage is incomplete")

    const first = {
      id: "first",
      seriesId: "series",
      occurrenceDate: "2026-08-01",
      replacementForOccurrenceId: "second",
    }
    const second = {
      id: "second",
      seriesId: "series",
      occurrenceDate: "2026-08-02",
      replacementForOccurrenceId: "first",
    }
    expect(() => resolveOccurrenceEligibilityDates({} as never, [first, second]))
      .toThrow("lineage contains a cycle")

    expect(() => resolveOccurrenceEligibilityDates(executorReturning([{
      id: "source",
      seriesId: "other-series",
      occurrenceDate: "2026-08-01",
      replacementForOccurrenceId: null,
    }]), [replacement])).toThrow("lineage crosses session series")
  })
})

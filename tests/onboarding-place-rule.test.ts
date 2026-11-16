import { describe, expect, it } from "vitest"

import { addCalendarDays } from "@/lib/finance/domain"
import { placeReachesWindow } from "@/lib/sessions/term"

/*
 * Onboarding's fee timeline used to write the place rule out by hand twice: which
 * places still cover a day from the training start, and whether a usable place
 * covers a month. It now calls placeReachesWindow. These pin that the shared rule
 * gives the old answers on every combination of dates below.
 */
const days = ["2026-10-30", "2026-11-01", "2026-11-02", "2026-11-15", "2026-11-30", "2026-12-01", "2026-12-02"]
const optional = [null, ...days]

function oldUsable(trainingStartOn: string, place: { effectiveFrom: string; effectiveTo: string | null }, seriesStartsOn: string, seriesEndsOn: string | null) {
  const start = [trainingStartOn, place.effectiveFrom, seriesStartsOn].reduce((latest, value) => value > latest ? value : latest)
  return (place.effectiveTo === null || place.effectiveTo > start)
    && (seriesEndsOn === null || seriesEndsOn >= start)
}

function oldCovered(place: { effectiveFrom: string; effectiveTo: string | null }, seriesStartsOn: string, seriesEndsOn: string | null, monthStart: string, monthEnd: string) {
  return place.effectiveFrom <= monthEnd
    && (place.effectiveTo === null || place.effectiveTo > monthStart)
    && seriesStartsOn <= monthEnd
    && (seriesEndsOn === null || seriesEndsOn >= monthStart)
}

describe("onboarding's place checks use the shared place rule", () => {
  it("gives the old answers for usable places and month coverage", () => {
    let usableCases = 0
    for (const trainingStartOn of days) {
      for (const effectiveFrom of days) {
        for (const effectiveTo of optional) {
          for (const seriesStartsOn of days) {
            for (const seriesEndsOn of optional) {
              const place = { effectiveFrom, effectiveTo }
              const start = [trainingStartOn, effectiveFrom, seriesStartsOn]
                .reduce((latest, value) => value > latest ? value : latest)
              const usable = placeReachesWindow(place, { endsOn: seriesEndsOn }, start, null)
              expect(usable).toBe(oldUsable(trainingStartOn, place, seriesStartsOn, seriesEndsOn))
              if (!usable) continue
              usableCases += 1
              // Month coverage is only ever asked of usable places.
              for (const [monthStart, monthEnd] of [["2026-10-01", "2026-10-31"], ["2026-11-01", "2026-11-30"], ["2026-12-01", "2026-12-31"]]) {
                expect(placeReachesWindow(
                  place,
                  { endsOn: seriesEndsOn, startsOn: seriesStartsOn },
                  monthStart,
                  addCalendarDays(monthEnd, 1),
                )).toBe(oldCovered(place, seriesStartsOn, seriesEndsOn, monthStart, monthEnd))
              }
            }
          }
        }
      }
    }
    expect(usableCases).toBeGreaterThan(100)
  })
})

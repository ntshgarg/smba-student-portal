import fc from "fast-check"
import { describe, expect, it } from "vitest"

import {
  buildOccurrenceDrafts,
  dateRangesOverlapInclusive,
  indiaLocalDateTime,
} from "@/lib/sessions/domain"
import {
  academyTimeInputValue,
  getAcademyDateKey,
  getAcademyMonthKey,
} from "@/lib/format"

const PROPERTY_RUNS = 200
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1_000
const DATE_EPOCH = Date.UTC(2000, 0, 1)
const MAXIMUM_DAY_OFFSET = Math.floor(
  (Date.UTC(2099, 11, 31) - DATE_EPOCH) / DAY_IN_MILLISECONDS,
)

function dateKeyFromOffset(offset: number) {
  return new Date(DATE_EPOCH + offset * DAY_IN_MILLISECONDS)
    .toISOString()
    .slice(0, 10)
}

function followingDate(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

const dateKeyArbitrary = fc.integer({ min: 0, max: MAXIMUM_DAY_OFFSET })
  .map(dateKeyFromOffset)

const timeArbitrary = fc.record({
  hour: fc.integer({ min: 0, max: 23 }),
  minute: fc.integer({ min: 0, max: 59 }),
}).map(({ hour, minute }) => (
  `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
))

const boundedOrOpenRangeArbitrary = fc.record({
  length: fc.integer({ min: 0, max: 365 }),
  openEnded: fc.boolean(),
  startOffset: fc.integer({ min: 0, max: MAXIMUM_DAY_OFFSET - 365 }),
}).map(({ length, openEnded, startOffset }) => ({
  startsOn: dateKeyFromOffset(startOffset),
  endsOn: openEnded ? null : dateKeyFromOffset(startOffset + length),
}))

const slotSeedsArbitrary = fc.uniqueArray(fc.record({
  durationMinutes: fc.integer({ min: 30, max: 300 }),
  hour: fc.integer({ min: 5, max: 18 }),
  minute: fc.integer({ min: 0, max: 59 }),
  weekday: fc.integer({ min: 0, max: 6 }),
}), {
  minLength: 1,
  maxLength: 7,
  selector: (slot) => slot.weekday,
}).map((slots) => slots.map((slot) => ({
  id: `slot-${slot.weekday}`,
  weekday: slot.weekday,
  startTime: `${String(slot.hour).padStart(2, "0")}:${String(slot.minute).padStart(2, "0")}`,
  durationMinutes: slot.durationMinutes,
})))

const recurrenceWindowArbitrary = fc.integer({
  min: 30,
  max: MAXIMUM_DAY_OFFSET - 120,
}).chain((seriesStartOffset) => (
  fc.integer({ min: 7, max: 90 }).chain((seriesLength) => (
    fc.integer({ min: 0, max: seriesLength }).chain((narrowStartDelta) => (
      fc.record({
        leftPadding: fc.integer({ min: 0, max: 30 }),
        narrowEndDelta: fc.integer({ min: narrowStartDelta, max: seriesLength }),
        rightPadding: fc.integer({ min: 0, max: 30 }),
      }).map(({ leftPadding, narrowEndDelta, rightPadding }) => ({
        narrowFrom: dateKeyFromOffset(seriesStartOffset + narrowStartDelta),
        narrowTo: dateKeyFromOffset(seriesStartOffset + narrowEndDelta),
        seriesEndsOn: dateKeyFromOffset(seriesStartOffset + seriesLength),
        seriesStartsOn: dateKeyFromOffset(seriesStartOffset),
        wideFrom: dateKeyFromOffset(seriesStartOffset - leftPadding),
        wideTo: dateKeyFromOffset(seriesStartOffset + seriesLength + rightPadding),
      }))
    ))
  ))
))

describe("session and academy-time properties", () => {
  it("generates chronological, unique recurrence drafts within the effective window", () => {
    fc.assert(fc.property(
      recurrenceWindowArbitrary,
      slotSeedsArbitrary,
      (window, slots) => {
        const series = {
          id: "series-under-test",
          startsOn: window.seriesStartsOn,
          endsOn: window.seriesEndsOn,
          venue: "SMBA Court",
        }
        const drafts = buildOccurrenceDrafts({
          from: window.narrowFrom,
          to: window.narrowTo,
          series,
          slots,
        })
        const occurrenceDates = drafts.map((draft) => draft.occurrenceDate)
        const slotByWeekday = new Map(slots.map((slot) => [slot.weekday, slot]))

        expect(occurrenceDates).toEqual([...occurrenceDates].sort())
        expect(new Set(occurrenceDates).size).toBe(occurrenceDates.length)

        drafts.forEach((draft) => {
          expect(draft.occurrenceDate >= window.narrowFrom).toBe(true)
          expect(draft.occurrenceDate <= window.narrowTo).toBe(true)
          expect(draft.occurrenceDate >= window.seriesStartsOn).toBe(true)
          expect(draft.occurrenceDate <= window.seriesEndsOn).toBe(true)

          const weekday = new Date(`${draft.occurrenceDate}T00:00:00.000Z`).getUTCDay()
          const slot = slotByWeekday.get(weekday)
          expect(slot).toBeDefined()
          expect(draft).toMatchObject({
            seriesId: series.id,
            durationMinutes: slot?.durationMinutes,
            venue: series.venue,
          })
          expect(getAcademyDateKey(draft.startsAt)).toBe(draft.occurrenceDate)
          expect(academyTimeInputValue(draft.startsAt)).toBe(slot?.startTime)
        })
      },
    ), { numRuns: PROPERTY_RUNS })
  })

  it("never removes recurrence drafts when the requested window is widened", () => {
    fc.assert(fc.property(
      recurrenceWindowArbitrary,
      slotSeedsArbitrary,
      (window, slots) => {
        const series = {
          id: "series-under-test",
          startsOn: window.seriesStartsOn,
          endsOn: window.seriesEndsOn,
          venue: "SMBA Court",
        }
        const narrowDrafts = buildOccurrenceDrafts({
          from: window.narrowFrom,
          to: window.narrowTo,
          series,
          slots,
        })
        const wideDrafts = buildOccurrenceDrafts({
          from: window.wideFrom,
          to: window.wideTo,
          series,
          slots,
        })
        const wideDraftByDate = new Map(
          wideDrafts.map((draft) => [draft.occurrenceDate, draft]),
        )

        narrowDrafts.forEach((draft) => {
          expect(wideDraftByDate.get(draft.occurrenceDate)).toEqual(draft)
        })
      },
    ), { numRuns: PROPERTY_RUNS })
  })

  it("treats inclusive schedule overlap symmetrically and reflexively", () => {
    fc.assert(fc.property(
      boundedOrOpenRangeArbitrary,
      boundedOrOpenRangeArbitrary,
      (left, right) => {
        expect(dateRangesOverlapInclusive(left, right))
          .toBe(dateRangesOverlapInclusive(right, left))
        expect(dateRangesOverlapInclusive(left, left)).toBe(true)
        expect(dateRangesOverlapInclusive(right, right)).toBe(true)
      },
    ), { numRuns: PROPERTY_RUNS })
  })

  it("overlaps on a shared boundary but permits a term beginning the following day", () => {
    const adjacentRangesArbitrary = fc.record({
      leftLength: fc.integer({ min: 0, max: 365 }),
      rightLength: fc.integer({ min: 0, max: 365 }),
      startOffset: fc.integer({ min: 0, max: MAXIMUM_DAY_OFFSET - 731 }),
    })

    fc.assert(fc.property(adjacentRangesArbitrary, ({
      leftLength,
      rightLength,
      startOffset,
    }) => {
      const boundaryOffset = startOffset + leftLength
      const boundaryDate = dateKeyFromOffset(boundaryOffset)
      const left = {
        startsOn: dateKeyFromOffset(startOffset),
        endsOn: boundaryDate,
      }
      const sharedBoundary = {
        startsOn: boundaryDate,
        endsOn: dateKeyFromOffset(boundaryOffset + rightLength),
      }
      const followingStart = followingDate(boundaryDate)
      const followingTerm = {
        startsOn: followingStart,
        endsOn: dateKeyFromOffset(boundaryOffset + 1 + rightLength),
      }

      expect(dateRangesOverlapInclusive(left, sharedBoundary)).toBe(true)
      expect(dateRangesOverlapInclusive(left, followingTerm)).toBe(false)
    }), { numRuns: PROPERTY_RUNS })
  })

  it("round-trips academy-local date and time across supported input representations", () => {
    fc.assert(fc.property(dateKeyArbitrary, timeArbitrary, (dateKey, time) => {
      const instant = indiaLocalDateTime(dateKey, time)
      const representations = [instant, instant.getTime(), instant.toISOString()]

      representations.forEach((representation) => {
        expect(getAcademyDateKey(representation)).toBe(dateKey)
        expect(getAcademyMonthKey(representation)).toBe(dateKey.slice(0, 7))
        expect(academyTimeInputValue(representation)).toBe(time)
      })
    }), { numRuns: PROPERTY_RUNS })
  })
})

import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { occurrenceIsUpcoming } from "@/lib/sessions/occurrence-time"

/**
 * The three coach registers re-read "now" every 30 seconds so a session that
 * starts while the coach is watching becomes markable without a reload. This
 * pins whose "now" that is: the instant the server rendered with, advanced by
 * elapsed time -- never the handset's own clock.
 *
 * Two things ride on it. Courtside, a phone whose clock is minutes out decided
 * whether a session had started, and `occurrenceIsUpcoming` gates whole controls
 * on that answer. For the accessibility gate, `academyNow()` can pin the server
 * (`lib/clock.ts`), and a tick that adopted the browser's clock un-pinned the
 * audited DOM 30 seconds after load -- today by nine days, and by one more day
 * for every day that passes.
 */
const PINNED_SERVER_INSTANT = Date.parse("2026-08-17T09:30:00+05:30")
const DEVICE_WALL_CLOCK = Date.parse("2026-08-26T09:30:00+05:30")
// Starts after the pinned server render and before the device's clock, so the
// two disagree about whether it can be marked yet.
const OCCURRENCE = {
  durationMinutes: 90,
  eligibilityDate: "2026-08-20",
  id: "occurrence-1",
  occurrenceDate: "2026-08-20",
  replacementForOccurrenceId: null,
  seriesId: "series-1",
  startsAt: "2026-08-20T00:30:00.000Z",
  status: "scheduled" as const,
  venue: "Court 1",
}
const SERIES = {
  batch: "Weekday",
  endsOn: null,
  id: "series-1",
  programme: "Beginner",
  slots: [],
  startsOn: "2026-08-01",
  status: "active" as const,
  title: "Beginner Weekday",
  venue: "Court 1",
}

const clockFixture = vi.hoisted(() => ({
  effects: [] as Array<() => unknown>,
  intervals: [] as Array<{ callback: () => void; delay: number }>,
  updates: [] as Array<{ initial: unknown; next: unknown }>,
}))

/**
 * `renderToStaticMarkup` never runs an effect, so the tick is unreachable from a
 * server render and its state update is swallowed. Recording both, and running
 * them by hand, is what makes the interval observable at all in this suite --
 * there is no DOM environment here to mount into.
 */
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react")
  return {
    ...actual,
    useEffect: (effect: () => unknown) => {
      clockFixture.effects.push(effect)
    },
    useState: (initial: unknown) => {
      const [value] = actual.useState(initial as never) as [unknown, unknown]
      return [value, (next: unknown) => clockFixture.updates.push({ initial, next })]
    },
  }
})

vi.mock("next/navigation", () => ({
  usePathname: () => "/coach/attendance/players/register",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock("@/components/unsaved-work-guard", () => ({
  useUnsavedWorkGuard: () => ({
    confirmDiscard: vi.fn(() => true),
    confirmNavigation: vi.fn(() => true),
    navigateAfterCommit: (navigate: () => void) => navigate(),
  }),
}))

vi.mock("@/components/coach/coach-portal-provider", () => ({
  useAttendancePortal: () => ({
    attendanceAdjustments: [],
    attendanceRecords: {},
    saveAttendanceRegister: vi.fn(),
  }),
  useMemberPortal: () => ({ players: [] }),
  useSessionPortal: () => ({
    academyHolidays: [],
    cancelSessionOccurrence: vi.fn(),
    replaceSessionOccurrence: vi.fn(),
    retractAcademyHoliday: vi.fn(),
    sessionAssignments: [],
    sessionOccurrences: [OCCURRENCE],
    sessionSeries: [SERIES],
  }),
}))

const { PlayerAttendanceRecorder } = await import(
  "@/components/coach/attendance/player-attendance-recorder"
)
const { PlayerAttendanceRegister } = await import(
  "@/components/coach/player-attendance-register"
)
const { SessionCalendar } = await import("@/components/coach/calendar/session-calendar")

const windowStub = {
  clearInterval: () => undefined,
  setInterval: (callback: () => void, delay: number) => {
    clockFixture.intervals.push({ callback, delay })
    return clockFixture.intervals.length
  },
}

/**
 * Renders, then runs what the browser would run. Effects that need a document
 * are expected to fail here -- draft restoration reads session storage, the
 * register measures a scroll container -- and are allowed to, because the one
 * under test only asks for `window.setInterval`. The 30s interval is then
 * asserted to be present exactly once, so an effect that failed on its way to
 * registering one cannot pass as an effect that never had one.
 */
function tickAfterMount(render: () => void) {
  clockFixture.effects.length = 0
  clockFixture.intervals.length = 0
  clockFixture.updates.length = 0
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(DEVICE_WALL_CLOCK)
  render()
  for (const effect of clockFixture.effects) {
    try {
      effect()
    } catch {
      // Not this effect. See the note above.
    }
  }
  const ticks = clockFixture.intervals.filter(({ delay }) => delay === 30_000)
  expect(ticks).toHaveLength(1)
  vi.setSystemTime(DEVICE_WALL_CLOCK + 30_000)
  ticks[0].callback()
  const update = clockFixture.updates.find(({ initial }) => initial === PINNED_SERVER_INSTANT)
  if (!update) throw new Error("the 30s tick set no reference instant")
  return update.next as number
}

describe("the coach registers' 30-second reference clock", () => {
  beforeEach(() => {
    ;(globalThis as { window?: unknown }).window = windowStub
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (globalThis as { window?: unknown }).window
  })

  it.each([
    ["the session calendar", () => {
      renderToStaticMarkup(
        <SessionCalendar
          referenceDate="2026-08-17"
          referenceInstant={PINNED_SERVER_INSTANT}
          selectedDate="2026-08-20"
        />,
      )
    }],
    ["the player attendance register", () => {
      renderToStaticMarkup(
        <PlayerAttendanceRegister
          referenceDate="2026-08-17"
          referenceInstant={PINNED_SERVER_INSTANT}
          selection={{ batch: "Weekday", programme: "Beginner", year: 2026 }}
          yearOptions={[2026]}
        />,
      )
    }],
    ["the player attendance recorder", () => {
      renderToStaticMarkup(
        <PlayerAttendanceRecorder
          initialDate="2026-08-20"
          initialFromCalendar={false}
          initialOccurrenceId="occurrence-1"
          initialReferenceInstant={PINNED_SERVER_INSTANT}
        />,
      )
    }],
  ])("advances %s from the server's instant, not the device's clock", (_name, render) => {
    // The two clocks disagree by nine days here, which is what the accessibility
    // pin currently holds back, and they disagree about this session: the server
    // says it has not started, the handset says it has.
    expect(occurrenceIsUpcoming(OCCURRENCE, PINNED_SERVER_INSTANT)).toBe(true)
    expect(occurrenceIsUpcoming(OCCURRENCE, DEVICE_WALL_CLOCK)).toBe(false)

    const afterTheTick = tickAfterMount(render)

    expect(afterTheTick).toBe(PINNED_SERVER_INSTANT + 30_000)
    expect(occurrenceIsUpcoming(OCCURRENCE, afterTheTick)).toBe(true)
  })
})

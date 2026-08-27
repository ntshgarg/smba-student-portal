import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * The recorder is served one date at a time: `getCoachAttendanceRecorderSnapshot`
 * queries `{ from: dateKey, to: dateKey }`, so the provider holds exactly the
 * occurrences of the date the page was rendered for. Choosing another date puts
 * the register in a state this fixture reproduces directly — `selectedDate` is
 * already the new date while `sessionOccurrences` is still the old date's list.
 */
const { recorderFixture } = vi.hoisted(() => ({
  recorderFixture: {
    isChangingDate: false,
    // Every element the render creates, so the date input's handler can be
    // called where a browser would call it. See the runtime mocks below.
    renderedProps: [] as Array<Record<string, unknown>>,
    // Transition bodies are held rather than run, which is what makes "inside
    // the transition" observable: a navigation fired beside it would already
    // have reached the router.
    queuedTransitions: [] as Array<() => void>,
    replaced: [] as string[],
    occurrence: {
      durationMinutes: 90,
      eligibilityDate: "2026-08-21",
      id: "occurrence-1",
      occurrenceDate: "2026-08-21",
      replacementForOccurrenceId: null,
      seriesId: "series-1",
      startsAt: "2026-08-21T11:30:00.000Z",
      status: "scheduled",
      venue: "Court 1",
    },
    series: {
      batch: "Weekday",
      endsOn: null,
      id: "series-1",
      programme: "Beginner",
      slots: [],
      startsOn: "2026-08-01",
      status: "active",
      title: "Beginner Weekday",
      venue: "Court 1",
    },
  },
}))

/**
 * `renderToStaticMarkup` returns markup, not handlers, so the date input's
 * `onChange` is taken off the element as it is created. Vitest compiles JSX to
 * the development runtime; the production one is wrapped as well so the capture
 * does not depend on which transform the config picks, and a transform neither
 * covers fails loudly on the missing element rather than passing quietly.
 */
vi.mock("react/jsx-dev-runtime", async () => {
  const actual = await vi.importActual<Record<string, (...args: unknown[]) => unknown>>(
    "react/jsx-dev-runtime",
  )
  return {
    ...actual,
    jsxDEV: (...args: unknown[]) => {
      if (args[1] && typeof args[1] === "object") {
        recorderFixture.renderedProps.push(args[1] as Record<string, unknown>)
      }
      return actual.jsxDEV(...args)
    },
  }
})

vi.mock("react/jsx-runtime", async () => {
  const actual = await vi.importActual<Record<string, (...args: unknown[]) => unknown>>(
    "react/jsx-runtime",
  )
  const wrap = (name: "jsx" | "jsxs") => (...args: unknown[]) => {
    if (args[1] && typeof args[1] === "object") {
      recorderFixture.renderedProps.push(args[1] as Record<string, unknown>)
    }
    return actual[name](...args)
  }
  return { ...actual, jsx: wrap("jsx"), jsxs: wrap("jsxs") }
})

/**
 * A server render never re-renders, so its own `useTransition` can never report
 * pending. The flag is supplied instead, and the last test below is what ties it
 * to the date change that raises it.
 */
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react")
  return {
    ...actual,
    useTransition: () => [
      recorderFixture.isChangingDate,
      (run: () => void) => {
        recorderFixture.queuedTransitions.push(run)
      },
    ],
  }
})

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: (href: string) => {
      recorderFixture.replaced.push(href)
    },
  }),
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
    sessionAssignments: [],
    sessionOccurrences: [recorderFixture.occurrence],
    sessionSeries: [recorderFixture.series],
  }),
}))

const { PlayerAttendanceRecorder } = await import(
  "@/components/coach/attendance/player-attendance-recorder"
)

function renderRecorder(selectedDate: string) {
  recorderFixture.renderedProps.length = 0
  return renderToStaticMarkup(
    <PlayerAttendanceRecorder
      initialDate={selectedDate}
      initialFromCalendar={false}
      initialOccurrenceId={null}
      initialReferenceInstant={Date.parse("2026-08-21T12:00:00.000Z")}
    />,
  )
}

function chooseDate(dateKey: string) {
  const dateField = recorderFixture.renderedProps.find(
    (props) => props.name === "attendanceDate",
  )
  const onChange = dateField?.onChange as ((event: unknown) => void) | undefined
  if (!onChange) throw new Error("the recorder rendered no training date input")
  onChange({ target: { value: dateKey } })
}

describe("player attendance recorder date change", () => {
  afterEach(() => {
    recorderFixture.isChangingDate = false
    recorderFixture.queuedTransitions.length = 0
    recorderFixture.renderedProps.length = 0
    recorderFixture.replaced.length = 0
  })

  it("does not call a date empty while its sessions are still being fetched", () => {
    recorderFixture.isChangingDate = true

    const markup = renderRecorder("2026-08-22")

    expect(markup).not.toContain("No sessions on this date.")
    expect(markup).toContain("Loading sessions…")
    // The count asserts the same thing the copy does, so it withholds too.
    expect(markup).toContain("<strong>—</strong>")
    expect(markup).not.toContain("<strong>0</strong>")
  })

  it("still calls a settled date empty when the server has answered for it", () => {
    const markup = renderRecorder("2026-08-22")

    expect(markup).toContain("No sessions on this date.")
    expect(markup).not.toContain("Loading sessions…")
    expect(markup).toContain("<strong>0</strong>")
  })

  it("keeps a settled date's own sessions on screen", () => {
    const markup = renderRecorder("2026-08-21")

    expect(markup).not.toContain("No sessions on this date.")
    expect(markup).not.toContain("Loading sessions…")
    expect(markup).toContain("<strong>1</strong>")
  })

  // What raises the pending flag above is the date change putting its navigation
  // inside the transition, so this is what pins the two together: pick a date on
  // the real input and the router is not called until the transition body runs.
  it("defers the date navigation into the transition that raises the flag", () => {
    renderRecorder("2026-08-21")

    chooseDate("2026-08-22")

    expect(recorderFixture.replaced).toEqual([])
    expect(recorderFixture.queuedTransitions).toHaveLength(1)

    recorderFixture.queuedTransitions.shift()?.()

    expect(recorderFixture.replaced).toEqual([
      "/coach/attendance/players/record?date=2026-08-22",
    ])
  })
})

/*
 * The fixture above renders one started occurrence with no assignments and no
 * players, which is exactly the shape that used to read "Available": a session
 * the coach could open, but with nobody in it to mark.
 */
describe("player attendance recorder session picker", () => {
  it("says a session is empty rather than calling it available", () => {
    const html = renderRecorder("2026-08-21")
    expect(html).toContain("No players")
    expect(html).not.toContain(">Available<")
  })

  it("still reserves Upcoming for a session that has not started", () => {
    const html = renderToStaticMarkup(
      <PlayerAttendanceRecorder
        initialDate="2026-08-21"
        initialFromCalendar={false}
        initialOccurrenceId={null}
        initialReferenceInstant={Date.parse("2026-08-21T06:00:00.000Z")}
      />,
    )
    expect(html).toContain("Upcoming")
    expect(html).not.toContain("No players")
  })
})

import type { ReactElement, Ref } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * What the two courtside registers -- a session and the staff card on the Mark
 * tab -- do around a save that is still running, and around a date change that
 * has not landed yet.
 *
 * The suite has no DOM, so the approach is `tests/session-expiry-recovery`'s:
 * the JSX factory records every element the register creates, the handlers
 * are called directly, and the mocked `useState` both seeds the state under
 * test and records every update a handler makes.
 */
const captured = vi.hoisted(() => ({
  discarded: [] as string[],
  // Set while a date change is between the tap and the server's answer.
  changingDate: false,
  elements: [] as Array<{ props: Record<string, unknown>; type: unknown }>,
  guardMessages: [] as Array<{ message: string; scope: string }>,
  isSaving: false,
  keptOnDevice: undefined as boolean | undefined,
  persistReturns: false,
  replaced: [] as string[],
  stateUpdates: [] as unknown[],
  unsavedMarks: [] as unknown[],
}))

vi.mock("react/jsx-dev-runtime", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react/jsx-dev-runtime")
  const jsxDEV = actual.jsxDEV as (...args: never[]) => unknown
  return {
    ...actual,
    jsxDEV(type: never, props: never, ...rest: never[]) {
      captured.elements.push({ props: props as Record<string, unknown>, type })
      return jsxDEV(type, props, ...rest)
    },
  }
})

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react")
  return {
    ...actual,
    useEffect: () => {},
    // A server render runs no layout effects, so the handle the Mark tab asks
    // of the staff card is built here, as React would after the commit.
    useImperativeHandle: (ref: { current: unknown } | null | undefined, create: () => unknown) => {
      if (ref) ref.current = create()
    },
    // A server render cannot start a transition; the date change's navigation
    // runs straight through instead, so it reaches the router mock.
    useTransition: () => [captured.changingDate, (run: () => void) => run()],
    useState: (initial: unknown) => {
      // Seams keyed on values each register holds once: the empty array is its
      // unsaved marks, `false` is `isSaving`, `undefined` is whether the device
      // kept the draft.
      let seed = initial
      if (Array.isArray(initial) && !initial.length) seed = captured.unsavedMarks
      if (initial === false) seed = captured.isSaving
      if (initial === undefined) seed = captured.keptOnDevice
      const [value, set] = actual.useState(seed)
      return [value, (next: unknown) => {
        captured.stateUpdates.push(next)
        set(next)
      }]
    },
  }
})

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: (href: string) => {
      captured.replaced.push(href)
    },
  }),
}))

vi.mock("@/components/unsaved-work-guard", () => ({
  useUnsavedWorkGuard: ({ message, scope }: { message: string; scope: string }) => {
    captured.guardMessages.push({ message, scope })
    return { confirmDiscard: vi.fn(() => true) }
  },
}))

vi.mock("@/lib/client/attendance-draft-storage", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/client/attendance-draft-storage")
  >("@/lib/client/attendance-draft-storage")
  return {
    ...actual,
    discardPlayerAttendanceDraft: (occurrenceId: string) => {
      captured.discarded.push(occurrenceId)
    },
    discardStaffAttendanceDraft: (dateKey: string) => {
      captured.discarded.push(dateKey)
    },
    persistPlayerAttendanceDraft: () => captured.persistReturns,
    persistStaffAttendanceDraft: () => captured.persistReturns,
  }
})

vi.mock("@/app/coach/actions", () => ({
  saveStaffAttendanceAction: vi.fn(() => new Promise(() => {})),
}))

function occurrence(id: string, startsAt: string) {
  return {
    durationMinutes: 60,
    eligibilityDate: "2026-08-21",
    id,
    occurrenceDate: "2026-08-21",
    replacementForOccurrenceId: null,
    seriesId: "series-1",
    startsAt,
    status: "scheduled",
    venue: "Court 1",
  }
}

vi.mock("@/components/coach/coach-portal-provider", () => ({
  useAttendancePortal: () => ({
    attendanceAdjustments: [],
    attendanceRecords: {},
    saveAttendanceRegister: vi.fn(() => new Promise(() => {})),
  }),
  useMemberPortal: () => ({
    players: [{ member: { fullName: "Asha Rao", id: "player-1", trainingStartOn: "2026-08-01" } }],
  }),
  useSessionPortal: () => ({
    sessionAssignments: [{
      effectiveFrom: "2026-08-01",
      effectiveTo: null,
      id: "assignment-1",
      playerId: "player-1",
      seriesId: "series-1",
      weekdays: [new Date("2026-08-21T00:00:00.000Z").getUTCDay()],
    }],
    sessionOccurrences: [
      occurrence("occurrence-1", "2026-08-21T04:00:00.000Z"),
      occurrence("occurrence-2", "2026-08-21T06:00:00.000Z"),
    ],
    sessionSeries: [{
      batch: "Weekday",
      endsOn: null,
      id: "series-1",
      programme: "Advanced",
      slots: [],
      startsOn: "2026-01-05",
      status: "active",
      title: "Advanced weekday",
      venue: "Court 1",
    }],
  }),
}))

const { describeRefusedSave } = await import("@/lib/client/session-expiry")
const { StaffRollCall } = await import("@/components/coach/attendance/staff-roll-call")
type StaffRollCallHandle = import("@/components/coach/attendance/staff-roll-call").StaffRollCallHandle
const { PlayerAttendanceRecorder } = await import(
  "@/components/coach/attendance/player-attendance-recorder"
)

const oneUnsavedPlayerMark = [{
  choice: "present",
  expectedChoice: "cleared",
  occurrenceId: "occurrence-1",
  playerId: "player-1",
}]

const oneUnsavedStaffMark = [{
  choice: "present",
  coachAccountId: "coach-1",
  dateKey: "2026-08-20",
  expectedChoice: "cleared",
}]

const ishaan = {
  accountId: "coach-1",
  fullName: "Ishaan Rao",
  initials: "IR",
  joinedOn: "2026-01-05",
}

function playerRegister(): ReactElement {
  return (
    <PlayerAttendanceRecorder
      initialDate="2026-08-21"
      initialFromCalendar={false}
      initialOccurrenceId="occurrence-1"
      initialReferenceInstant={Date.parse("2026-08-21T12:00:00.000Z")}
      initialStaffOpen={false}
      staff={{
        closedFor: null,
        juniorCoaches: [ishaan],
        records: [{ choice: "present", coachAccountId: "coach-1" }],
        referenceDate: "2026-08-23",
      }}
    />
  )
}

const rollCallHandle: { current: StaffRollCallHandle | null } = { current: null }

function rollCall(): ReactElement {
  return (
    <StaffRollCall
      ref={rollCallHandle as Ref<StaffRollCallHandle>}
      closedFor={null}
      dateKey="2026-08-20"
      initialRecords={[{ choice: "absent", coachAccountId: "coach-1" }]}
      juniorCoaches={[ishaan]}
      open
      referenceDate="2026-08-23"
      onToggle={() => {}}
    />
  )
}

/** The player register's own leave prompt; the staff card on the tab has its own. */
function playerGuardMessage() {
  return captured.guardMessages.findLast(({ scope }) => scope === "record-player-attendance")?.message
}

function render(register: () => ReactElement) {
  captured.elements.length = 0
  captured.guardMessages.length = 0
  captured.stateUpdates.length = 0
  return renderToStaticMarkup(register())
}

function pickDate(dateKey: string) {
  const dateField = captured.elements.find((element) => element.props.name === "attendanceDate")
  const onChange = dateField?.props.onChange as ((event: unknown) => void) | undefined
  if (!onChange) throw new Error("the register rendered no date input")
  onChange({ target: { value: dateKey } })
}

function lastMessage() {
  const feedback = captured.stateUpdates.findLast((update) => (
    !!update && typeof update === "object" && "message" in update
  )) as { message: string } | undefined
  return feedback?.message
}

afterEach(() => {
  captured.changingDate = false
  captured.discarded.length = 0
  captured.isSaving = false
  captured.keptOnDevice = undefined
  captured.persistReturns = false
  captured.replaced.length = 0
  rollCallHandle.current = null
  captured.unsavedMarks = []
})

describe("a player register save in flight", () => {
  it("keeps the date where it is, and the marks being saved", () => {
    captured.isSaving = true
    captured.unsavedMarks = oneUnsavedPlayerMark
    render(playerRegister)

    pickDate("2026-08-22")

    expect(captured.replaced).toEqual([])
    expect(captured.discarded).toEqual([])
    expect(captured.stateUpdates).not.toContainEqual([])
    expect(lastMessage()).toContain("Attendance is still saving")
  })

  it("keeps the session where it is", () => {
    captured.isSaving = true
    captured.unsavedMarks = oneUnsavedPlayerMark
    render(playerRegister)

    const otherSession = captured.elements.find((element) => (
      element.type === "button"
      && element.props["aria-expanded"] === false
      // a session's head; the staff card's carries no `disabled` at all
      && element.props.disabled === false
    ))
    expect(otherSession, "the register rendered no other session to pick").toBeTruthy()
    ;(otherSession?.props.onClick as () => void)()

    expect(captured.replaced).toEqual([])
    expect(captured.discarded).toEqual([])
    expect(lastMessage()).toContain("Attendance is still saving")
  })

  it("still lets the date change once nothing is saving", () => {
    captured.unsavedMarks = oneUnsavedPlayerMark
    render(playerRegister)

    pickDate("2026-08-22")

    expect(captured.discarded).toEqual(["occurrence-1"])
    expect(captured.replaced).toHaveLength(1)
  })
})

describe("the Mark tab's cards", () => {
  // A closed card's panel is not on the page, so only the open card points at one.
  it("point screen readers only at the open card's register", () => {
    render(playerRegister)

    expect(captured.elements
      .filter((element) => element.type === "button" && element.props["aria-controls"])
      .map((element) => element.props["aria-controls"])).toEqual(["attendance-roster-panel"])
  })
})

describe("the player register's leave prompt", () => {
  it("says the marks are kept when the device kept them", () => {
    captured.unsavedMarks = oneUnsavedPlayerMark
    captured.keptOnDevice = true
    render(playerRegister)

    expect(playerGuardMessage()).toBe(
      "Leave this session? Your unsaved marks are kept on this device"
      + " and come back when you open it again.",
    )
  })

  it("still says discard when the device could not keep them", () => {
    captured.unsavedMarks = oneUnsavedPlayerMark
    captured.keptOnDevice = false
    render(playerRegister)

    expect(playerGuardMessage())
      .toBe("Leave this session and discard the unsaved attendance changes?")
  })

  it("learns from each mark whether the device kept it", () => {
    captured.persistReturns = true
    render(playerRegister)

    const present = captured.elements.find((element) => (
      element.type === "button"
      && element.props["aria-pressed"] !== undefined
      && [element.props.children].flat().includes("Present")
    ))
    expect(present, "the register rendered no Present button").toBeTruthy()
    ;(present?.props.onClick as () => void)()

    expect(captured.stateUpdates).toContain(true)
  })
})

describe("the staff card", () => {
  // The Mark tab asks the open card to let go before it opens another card or
  // changes the date; a running save holds it where it is.
  it("keeps its marks and stays open while a save is in flight", () => {
    captured.isSaving = true
    captured.unsavedMarks = oneUnsavedStaffMark
    render(rollCall)

    expect(rollCallHandle.current?.release()).toBe(false)

    expect(captured.discarded).toEqual([])
    expect(lastMessage()).toContain("Staff attendance is still saving")
  })

  it("discards its marks when the coach lets them go", () => {
    captured.unsavedMarks = oneUnsavedStaffMark
    render(rollCall)

    expect(rollCallHandle.current?.release()).toBe(true)

    expect(captured.discarded).toEqual(["2026-08-20"])
    expect(captured.stateUpdates).toContainEqual([])
  })

  // Between picking a day and the server answering for it, the records held
  // are the previous day's. They must not be shown as the new day's, nor be
  // the base a tap is resolved against.
  it("withholds the previous day's marks until the new day arrives", () => {
    captured.changingDate = true
    const markup = render(playerRegister)

    expect(markup).toContain("Loading sessions…")
    expect(markup).not.toContain("Assistant coaches")
    expect(markup).not.toContain('aria-pressed="true"')
  })

  it("shows the day's marks once the day it rendered for is the one selected", () => {
    const markup = render(rollCall)

    expect(markup).not.toContain("Loading sessions…")
    expect(markup).toContain('aria-pressed="true"')
  })
})

describe("a conflict that asks for a refresh", () => {
  const conflict = {
    code: "CONFLICT",
    message: "Player attendance changed since this page was opened. Refresh and try again.",
  }

  // The refresh brings marks back only from the device's copy.
  it("warns that a refresh clears marks the device did not keep", () => {
    expect(describeRefusedSave(conflict, {
      marksOnDevice: () => false,
      place: "session",
      subject: "Attendance",
    }).message).toBe(
      "Player attendance changed since this page was opened. Refresh and try again."
      + " These marks are only on this screen and a refresh will clear them,"
      + " so note them before you refresh.",
    )
  })

  it("leaves the sentence alone when the device kept them", () => {
    expect(describeRefusedSave(conflict, {
      marksOnDevice: () => true,
      place: "session",
      subject: "Attendance",
    }).message).toBe(conflict.message)
  })
})

import type { ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * G-14. The courtside half of the fix: a `SESSION_EXPIRED` result that no
 * component recognises is still an opaque failure, so this drives both
 * registers to a refused save and reads what the coach is left holding -- the
 * sentence, the way out, and the confirmation they meet on the way to it.
 *
 * The suite has no DOM, so React's own dispatch cannot be driven here, as
 * `tests/resilient-action-state.test.tsx` records. What can be driven is the
 * handler each register hands to its save button: the JSX factory is wrapped so
 * every element the register creates is captured on its way past, and the
 * button's `onClick` is then called directly. Only the dev factory is wrapped,
 * which is the one Vitest's transform emits for this project's own TSX --
 * `lucide-react` and `next/link` ship compiled against the production factory
 * and stay untouched, so what is captured is the register's own markup and
 * nothing else. A transform that stopped emitting it would fail these tests on
 * a missing button rather than pass them quietly.
 *
 * The second render is how a static render sees a state update: the recorded
 * feedback is fed back in as the register's own initial feedback, which is the
 * render React would have done itself.
 */
const captured = vi.hoisted(() => ({
  elements: [] as Array<{ props: Record<string, unknown>; type: unknown }>,
  feedback: null as unknown,
  guardMessages: [] as string[],
  marksOnDevice: [] as unknown[],
  saveResult: null as unknown,
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
    // The restore effect is not what is under test, and a static render never
    // runs it anyway.
    useEffect: () => {},
    useState: (initial: unknown) => {
      // Two seams, both keyed on a value each register holds exactly once: the
      // empty array is its unsaved marks, which have to be non-empty before the
      // save button will do anything, and `null` is its feedback, which is how
      // the second render below stands in for a re-render. Both registers are
      // therefore given a non-empty stored record and a non-null selected
      // occurrence, so no other `useState` collides with either seam.
      let seed = initial
      if (Array.isArray(initial) && !initial.length) seed = captured.unsavedMarks
      if (initial === null) seed = captured.feedback
      const [value, set] = actual.useState(seed)
      return [value, (next: unknown) => {
        captured.stateUpdates.push(next)
        set(next)
      }]
    },
  }
})

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}))

/**
 * The guard's message is the sentence `window.confirm` shows when the coach
 * leaves the page with marks unsaved, so recording what each register registers
 * is how the confirmation the coach actually meets is read.
 */
vi.mock("@/components/unsaved-work-guard", () => ({
  useUnsavedWorkGuard: ({ message }: { message: string }) => {
    captured.guardMessages.push(message)
    return {
      confirmDiscard: vi.fn(() => true),
      confirmNavigation: vi.fn(() => true),
      navigateAfterCommit: (navigate: () => void) => navigate(),
    }
  },
}))

/**
 * A node suite has no `localStorage`, so `attendanceDraftStorage()` returns
 * null and every draft read is empty. The read is what each register asks
 * before it promises the coach their marks survive leaving, so it is the seam:
 * `captured.marksOnDevice` stands in for what the device kept.
 */
vi.mock("@/lib/client/attendance-draft-storage", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/client/attendance-draft-storage")
  >("@/lib/client/attendance-draft-storage")
  return {
    ...actual,
    readPlayerAttendanceDraft: () => captured.marksOnDevice,
    readStaffAttendanceDraft: () => captured.marksOnDevice,
  }
})

vi.mock("@/app/coach/actions", () => ({
  saveStaffAttendanceAction: vi.fn(() => Promise.resolve(captured.saveResult)),
}))

/**
 * The player register reads its session through the coach portal rather than
 * importing an action, so the portal is where its save is intercepted. One
 * scheduled occurrence that has already started is the whole fixture: the save
 * path never reads the roster, so an empty one keeps the register's own
 * "No eligible players." branch on screen and the footer -- notice and save
 * button -- rendering exactly as it does with thirty.
 */
vi.mock("@/components/coach/coach-portal-provider", () => ({
  useAttendancePortal: () => ({
    attendanceAdjustments: [],
    attendanceRecords: {},
    saveAttendanceRegister: () => Promise.resolve(captured.saveResult),
  }),
  useMemberPortal: () => ({ players: [] }),
  useSessionPortal: () => ({
    sessionAssignments: [],
    sessionOccurrences: [{
      durationMinutes: 90,
      eligibilityDate: "2026-08-21",
      id: "occurrence-1",
      occurrenceDate: "2026-08-21",
      replacementForOccurrenceId: null,
      seriesId: "series-1",
      startsAt: "2026-08-21T10:00:00.000Z",
      status: "scheduled",
      venue: "Court 1",
    }],
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

const { StaffRollCall } = await import("@/components/coach/attendance/staff-roll-call")
const { PlayerAttendanceRecorder } = await import(
  "@/components/coach/attendance/player-attendance-recorder"
)

import {
  operationalActionFailure,
  SessionExpiredError,
} from "@/lib/actions/operational-result"

/**
 * Built from the production error class rather than typed out, so the value the
 * register is handed is the one `runCoachAction` returns and this test cannot
 * drift from the wire format. `tests/operational-action-results.test.ts` holds
 * the other end: that `saveStaffAttendanceAction` returns this instead of
 * throwing it.
 */
const expiredSession = operationalActionFailure(new SessionExpiredError())

const conflict = {
  code: "CONFLICT" as const,
  message: "This coach was marked elsewhere. Refresh and try again.",
  ok: false as const,
}

const oneUnsavedStaffMark = [{
  choice: "present",
  coachAccountId: "coach-1",
  dateKey: "2026-08-21",
  expectedChoice: "cleared",
}]

const oneUnsavedPlayerMark = [{
  choice: "present",
  expectedChoice: "cleared",
  occurrenceId: "occurrence-1",
  playerId: "player-1",
}]

const staffDiscardPrompt = "Leave this date and discard the unsaved staff attendance changes?"
const playerDiscardPrompt = "Leave this session and discard the unsaved attendance changes?"

function rollCall(): ReactElement {
  return (
    <StaffRollCall
      initialDate="2026-08-21"
      initialRecords={[{ choice: "cleared", coachAccountId: "coach-1" }]}
      juniorCoaches={[{
        accountId: "coach-1",
        fullName: "Ishaan Rao",
        initials: "IR",
        joinedOn: "2026-01-05",
      }]}
      referenceDate="2026-08-23"
    />
  )
}

function playerRegister(): ReactElement {
  return (
    <PlayerAttendanceRecorder
      initialDate="2026-08-21"
      initialFromCalendar={false}
      initialOccurrenceId="occurrence-1"
      initialReferenceInstant={Date.parse("2026-08-21T11:00:00.000Z")}
    />
  )
}

function render(register: () => ReactElement) {
  captured.elements.length = 0
  captured.guardMessages.length = 0
  return renderToStaticMarkup(register())
}

/** The sentence the guard is holding for this register right now. */
function leaveConfirmation(register: () => ReactElement) {
  render(register)
  return captured.guardMessages.at(-1)
}

/**
 * One refused save, watched from the coach's side: press the register's save
 * button, then re-render with whatever feedback the press produced.
 *
 * `onDevice` decides what the register's draft read returns when it asks
 * whether the marks would survive being left behind.
 */
async function saveAndRedraw(
  register: () => ReactElement,
  { marks, onDevice = true, result }: {
    marks: unknown[]
    onDevice?: boolean
    result: unknown
  },
) {
  captured.saveResult = result
  captured.unsavedMarks = marks
  captured.marksOnDevice = onDevice ? marks : []
  captured.stateUpdates.length = 0
  render(register)

  // The save button is the one button carrying `aria-busy`; the per-coach and
  // per-player Present and Absent buttons do not.
  const saveButton = captured.elements.find((element) => (
    element.type === "button" && "aria-busy" in element.props
  ))
  expect(saveButton, "the register rendered no save button").toBeTruthy()

  await (saveButton?.props.onClick as () => Promise<void>)()

  const feedback = captured.stateUpdates.findLast((update) => (
    !!update && typeof update === "object" && "message" in update
  )) as { message: string; signIn?: { href: string; label: string } } | undefined

  captured.feedback = feedback ?? null
  const markup = render(register)
  captured.feedback = null

  return { feedback, guardMessage: captured.guardMessages.at(-1), markup }
}

describe("an expired session gives the courtside register somewhere to go", () => {
  afterEach(() => {
    captured.feedback = null
    captured.marksOnDevice = []
    captured.saveResult = null
    captured.unsavedMarks = []
  })

  it("names the expiry, the way back, and links to it from the roll call", async () => {
    const { feedback, markup } = await saveAndRedraw(rollCall, {
      marks: oneUnsavedStaffMark,
      result: expiredSession,
    })

    expect(feedback?.message).toBe(
      "Staff attendance was not recorded because your sign-in expired."
      + " Your marks are kept on this device."
      + " Sign in, then open this date again to save.",
    )
    expect(feedback?.signIn).toEqual({ href: "/login", label: "Sign in" })
    expect(markup).toContain("Sign in, then open this date again to save")
    expect(markup).toContain('<a class="inline-notice-action" href="/login">Sign in</a>')
  })

  it("stops the roll call's leave confirmation contradicting that notice", async () => {
    expect(leaveConfirmation(rollCall)).toBe(staffDiscardPrompt)

    const { guardMessage } = await saveAndRedraw(rollCall, {
      marks: oneUnsavedStaffMark,
      result: expiredSession,
    })

    expect(guardMessage).toBe(
      "Leave this date? Your marks are kept on this device"
      + " and come back when you open it again.",
    )
  })

  it("promises the roll call nothing the device did not keep", async () => {
    const { feedback, guardMessage } = await saveAndRedraw(rollCall, {
      marks: oneUnsavedStaffMark,
      onDevice: false,
      result: expiredSession,
    })

    expect(feedback?.message).toBe(
      "Staff attendance was not recorded because your sign-in expired."
      + " These marks are only on this screen and will not come back:"
      + " sign in, then mark them again.",
    )
    expect(feedback?.signIn).toEqual({ href: "/login", label: "Sign in" })
    expect(guardMessage).toBe(staffDiscardPrompt)
  })

  it("leaves a refusal the coach can correct here alone, with no sign-in link", async () => {
    const { feedback, guardMessage, markup } = await saveAndRedraw(rollCall, {
      marks: oneUnsavedStaffMark,
      result: conflict,
    })

    expect(feedback?.message).toBe(conflict.message)
    expect(feedback?.signIn).toBeUndefined()
    expect(markup).toContain("This coach was marked elsewhere")
    expect(markup).not.toContain("/login")
    expect(guardMessage).toBe(staffDiscardPrompt)
  })

  it("names the expiry, the way back, and links to it from the player register", async () => {
    const { feedback, guardMessage, markup } = await saveAndRedraw(playerRegister, {
      marks: oneUnsavedPlayerMark,
      result: expiredSession,
    })

    expect(feedback?.message).toBe(
      "Attendance was not recorded because your sign-in expired."
      + " Your marks are kept on this device."
      + " Sign in, then open this session again to save.",
    )
    expect(feedback?.signIn).toEqual({ href: "/login", label: "Sign in" })
    expect(markup).toContain("Sign in, then open this session again to save")
    expect(markup).toContain('<a class="inline-notice-action" href="/login">Sign in</a>')
    expect(guardMessage).toBe(
      "Leave this session? Your marks are kept on this device"
      + " and come back when you open it again.",
    )
  })

  it("leaves the player register's correctable refusals alone too", async () => {
    const { feedback, guardMessage, markup } = await saveAndRedraw(playerRegister, {
      marks: oneUnsavedPlayerMark,
      result: {
        code: "CONFLICT" as const,
        message: "This player was marked elsewhere. Refresh and try again.",
        ok: false as const,
      },
    })

    expect(feedback?.message).toBe("This player was marked elsewhere. Refresh and try again.")
    expect(feedback?.signIn).toBeUndefined()
    expect(markup).toContain("This player was marked elsewhere")
    expect(markup).not.toContain("/login")
    expect(guardMessage).toBe(playerDiscardPrompt)
  })
})

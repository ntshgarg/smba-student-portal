import { isValidElement, type ReactElement, type ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

/*
 * The suite has no DOM, so React's own event dispatch cannot be driven. What
 * can be driven is the state each screen renders from: hooks are stubbed so a
 * component can be called as a plain function in a chosen state, and its real
 * handlers read off the element tree and pressed. The idiom is
 * tests/announcement-dialog-escape.test.ts. Every `useState` setter call is
 * recorded.
 */
const hooks = vi.hoisted(() => {
  const hooks = {
    effects: [] as Array<() => void | (() => void)>,
    index: 0,
    setters: [] as Array<{ index: number; value: unknown }>,
    reset() {
      hooks.effects.length = 0
      hooks.index = 0
      hooks.setters.length = 0
    },
  }
  return hooks
})

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react")
  return {
    ...actual,
    useCallback: (callback: unknown) => callback,
    useEffect: (effect: () => void | (() => void)) => {
      hooks.effects.push(effect)
    },
    useMemo: (factory: () => unknown) => factory(),
    useRef: (initial: unknown) => ({ current: initial === undefined ? null : initial }),
    useState: (initial: unknown) => {
      const index = hooks.index++
      const value = typeof initial === "function" ? (initial as () => unknown)() : initial
      return [value, (next: unknown) => hooks.setters.push({ index, value: next })]
    },
  }
})

const portal = vi.hoisted(() => ({
  createSessionSeries: vi.fn(),
  /** Navigations handed to the unsaved-work guard, not yet run. */
  navigateAfterCommit: [] as Array<() => void>,
  players: [] as unknown[],
  push: vi.fn(),
  readStaffAttendanceDraft: vi.fn(() => [] as unknown[]),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: portal.push, refresh: vi.fn(), replace: vi.fn() }),
}))
vi.mock("@/components/coach/coach-portal-provider", () => ({
  useMemberPortal: () => ({ players: portal.players }),
  useSessionPortal: () => ({
    createSessionSeries: portal.createSessionSeries,
    previewAcademyHolidays: vi.fn(),
  }),
}))
vi.mock("@/components/unsaved-work-guard", () => ({
  useUnsavedWorkGuard: () => ({
    confirmDiscard: () => true,
    confirmNavigation: () => true,
    navigateAfterCommit: (navigate: () => void) => {
      portal.navigateAfterCommit.push(navigate)
      return true
    },
  }),
}))
vi.mock("@/app/coach/actions", () => ({ saveStaffAttendanceAction: vi.fn() }))
vi.mock("@/lib/client/attendance-draft-storage", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/client/attendance-draft-storage")>(),
  readStaffAttendanceDraft: portal.readStaffAttendanceDraft,
}))

const { StaffRollCall } = await import("@/components/coach/attendance/staff-roll-call")
const { SessionScheduleCreate } = await import("@/components/coach/calendar/session-create")

type AnyElement = ReactElement<Record<string, unknown>>

function elements(node: ReactNode): AnyElement[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement(node)) return []
  const element = node as AnyElement
  return [element, ...elements(element.props.children as ReactNode)]
}

const settle = () => new Promise((done) => setImmediate(done))

afterEach(() => {
  vi.unstubAllGlobals()
  portal.createSessionSeries.mockReset()
  portal.navigateAfterCommit.length = 0
  portal.players = []
  portal.push.mockReset()
  portal.readStaffAttendanceDraft.mockReset()
  portal.readStaffAttendanceDraft.mockReturnValue([])
})

describe("the staff roll call on a closed day", () => {
  const ravi = { accountId: "ravi", fullName: "Ravi Kumar", initials: "RK", joinedOn: "2026-01-05" }

  function renderRollCall(closedFor: string | null) {
    hooks.reset()
    const tree = StaffRollCall({
      closedFor,
      initialDate: "2026-11-10",
      initialRecords: [{ choice: "absent", coachAccountId: "ravi" }],
      juniorCoaches: [ravi],
      referenceDate: "2026-11-13",
    }) as AnyElement
    const all = elements(tree)
    return {
      choices: all.filter((element) => element.type === "button" && "aria-pressed" in element.props),
      save: all.find((element) => (
        element.type === "button" && element.props.onClick !== undefined && "aria-busy" in element.props
      ))!,
    }
  }

  function runEffects() {
    vi.stubGlobal("window", {
      clearTimeout: () => {},
      setTimeout: (handler: () => void) => {
        handler()
        return 1
      },
    })
    hooks.effects.splice(0).forEach((effect) => effect())
  }

  it("shows a mark saved before the closure the way the register does: not at all", () => {
    const closed = renderRollCall("Diwali")

    expect(closed.choices.map((button) => button.props["aria-pressed"])).toEqual([false, false])
    expect(closed.choices.every((button) => button.props.disabled === true)).toBe(true)
    expect(closed.save.props["aria-disabled"]).toBe(true)

    // The same mark on an open day is shown as recorded.
    const open = renderRollCall(null)
    expect(open.choices.map((button) => button.props["aria-pressed"])).toEqual([false, true])
  })

  it("does not bring back unsaved marks onto a day nothing can be saved on", () => {
    portal.readStaffAttendanceDraft.mockReturnValue([
      { choice: "present", coachAccountId: "ravi", dateKey: "2026-11-10", expectedChoice: "absent" },
    ])

    renderRollCall("Diwali")
    runEffects()
    expect(portal.readStaffAttendanceDraft).not.toHaveBeenCalled()
    expect(hooks.setters).toEqual([])

    // An open day still restores them.
    renderRollCall(null)
    runEffects()
    expect(portal.readStaffAttendanceDraft).toHaveBeenCalledWith("2026-11-10")
  })

  it("ignores a press on a closed day", () => {
    const { choices } = renderRollCall("Diwali")

    ;(choices[0].props.onClick as () => void)()

    expect(hooks.setters).toEqual([])
  })
})

/*
 * The guard holds a history entry while the form is dirty, and releasing it
 * steps history back. A plain router.push made then was undone by that step,
 * so the coach stayed on Create schedule. The push now goes to the guard, which
 * runs it only once its own step back has landed -- that ordering is proven
 * against the real guard in tests/unsaved-work-committed-surface-callback.test.tsx
 * ("navigates a sole dirty surface only after its history boundary closes").
 */
describe("creating a schedule from a player's onboarding", () => {
  it("hands the return to onboarding to the guard instead of pushing it straight away", async () => {
    portal.players = [{
      member: { fullName: "Asha Rao", id: "player-1" },
      training: { batch: "Weekday", level: "Beginner" },
    }]
    portal.createSessionSeries.mockResolvedValue({ data: { createdSeriesId: "series-1" }, ok: true })
    hooks.reset()
    const tree = SessionScheduleCreate({ initialPlayerId: "player-1", today: "2026-11-13" }) as AnyElement
    const form = elements(tree).find((element) => element.type === "form")!

    ;(form.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault: vi.fn() })
    await settle()

    expect(portal.createSessionSeries).toHaveBeenCalledOnce()
    expect(portal.navigateAfterCommit).toHaveLength(1)
    expect(portal.push).not.toHaveBeenCalled()

    portal.navigateAfterCommit[0]()
    expect(portal.push).toHaveBeenCalledWith("/coach/onboarding?player=player-1")
  })

  it("stays on the page after an ordinary create", async () => {
    portal.createSessionSeries.mockResolvedValue({ data: { createdSeriesId: "series-1" }, ok: true })
    hooks.reset()
    const tree = SessionScheduleCreate({ today: "2026-11-13" }) as AnyElement
    const form = elements(tree).find((element) => element.type === "form")!

    ;(form.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault: vi.fn() })
    await settle()

    expect(portal.navigateAfterCommit).toHaveLength(0)
    expect(portal.push).not.toHaveBeenCalled()
  })
})

import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

// Same approach as tests/unsaved-work-committed-surface-callback.test.tsx: the
// suite has no DOM, so React never flushes mount effects by itself. They are
// recorded during the static render and run by hand here, which is also the only
// way to register a surface at a chosen moment -- both defects under test depend
// on when a surface becomes dirty relative to the guard's own timers.
const { mountEffects } = vi.hoisted(() => ({
  mountEffects: [] as Array<() => (() => void) | void>,
}))

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react")
  return {
    ...actual,
    useEffect: (effect: () => (() => void) | void) => {
      mountEffects.push(effect)
    },
  }
})

import { UnsavedWorkProvider, useUnsavedWorkGuard } from "@/components/unsaved-work-guard"

type SurfaceGuard = ReturnType<typeof useUnsavedWorkGuard>

type LeaveSiteEvent = { preventDefault: () => void; returnValue: boolean }

function stubBrowser() {
  const listeners = new Map<string, Array<(event?: unknown) => void>>()
  const microtasks: Array<() => void> = []
  const timers = new Map<number, { delay: number; handler: () => void }>()
  const back = vi.fn()
  const confirm = vi.fn(() => true)
  const pushState = vi.fn()
  let nextTimerId = 1

  const history = {
    back,
    pushState(state: Record<string, unknown>) {
      pushState(state)
      history.state = state
    },
    state: null as Record<string, unknown> | null,
  }

  function addEventListener(type: string, listener: (event?: unknown) => void) {
    listeners.set(type, [...(listeners.get(type) ?? []), listener])
  }

  vi.stubGlobal("window", {
    addEventListener,
    clearTimeout: (id: number) => timers.delete(id),
    confirm,
    history,
    location: { href: "https://smba.test/coach/attendance/staff/record" },
    queueMicrotask: (task: () => void) => microtasks.push(task),
    removeEventListener: () => {},
    setTimeout: (handler: () => void, delay = 0) => {
      const id = nextTimerId++
      timers.set(id, { delay, handler })
      return id
    },
  })
  vi.stubGlobal("document", { addEventListener, removeEventListener: () => {} })

  return {
    back,
    confirm,
    dispatch(type: string, event?: unknown) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event)
    },
    flushMicrotasks() {
      while (microtasks.length) microtasks.shift()?.()
    },
    history,
    pushState,
    // Fired by delay so the boundary release (0ms) and the navigation allowance
    // (1000ms) can be advanced independently, as real time would.
    runTimers(delay: number) {
      for (const [id, timer] of [...timers]) {
        if (timer.delay !== delay) continue
        timers.delete(id)
        timer.handler()
      }
    },
  }
}

function DirtySurface({
  onReady,
  scope,
}: {
  onReady: (guard: SurfaceGuard) => void
  scope: string
}) {
  onReady(useUnsavedWorkGuard({
    isDirty: true,
    message: `${scope} has unsaved work`,
    scope,
  }))
  return null
}

/**
 * Renders the real provider without registering anything. The provider records
 * its own listener effect before any child's, so that one is run immediately and
 * the surface registrations are handed back for the test to run when it wants.
 */
function mountDirtySurfaces(scopes: string[]) {
  const guards = new Map<string, SurfaceGuard>()

  renderToStaticMarkup(
    <UnsavedWorkProvider>
      {scopes.map((scope) => (
        <DirtySurface key={scope} onReady={(guard) => guards.set(scope, guard)} scope={scope} />
      ))}
    </UnsavedWorkProvider>,
  )
  const [attachListeners, ...registerSurfaces] = mountEffects.splice(0)
  attachListeners?.()

  return { guards, registerSurfaces }
}

function leaveSiteEvent(): LeaveSiteEvent & { preventDefault: ReturnType<typeof vi.fn> } {
  return { preventDefault: vi.fn(), returnValue: false }
}

describe("unsaved-work history boundary", () => {
  afterEach(() => {
    mountEffects.length = 0
    vi.unstubAllGlobals()
  })

  it("gives a surface dirtied inside the navigation allowance a boundary once the allowance lapses", () => {
    const browser = stubBrowser()
    const { guards, registerSurfaces } = mountDirtySurfaces([
      "record-player-attendance",
      "staff-roll-call",
    ])

    const releasePlayerRegister = registerSurfaces[0]?.()
    expect(browser.pushState).toHaveBeenCalledOnce()

    // The coach confirms leaving the player register, which grants the one
    // navigation allowance, and that register goes away with them.
    expect(guards.get("record-player-attendance")?.confirmNavigation()).toBe(true)
    releasePlayerRegister?.()
    browser.runTimers(0)

    // The staff roll call is marked inside the allowance window.
    registerSurfaces[1]?.()
    expect(browser.pushState).toHaveBeenCalledOnce()

    browser.runTimers(1_000)
    expect(browser.pushState).toHaveBeenCalledTimes(2)

    // The boundary now exists, so the back button reaches the coach.
    browser.confirm.mockClear()
    browser.dispatch("popstate")

    expect(browser.confirm).toHaveBeenCalledWith("staff-roll-call has unsaved work")
    expect(browser.back).toHaveBeenCalledOnce()
  })

  it("keeps one boundary when a second surface becomes dirty", () => {
    const browser = stubBrowser()
    const { registerSurfaces } = mountDirtySurfaces([
      "record-player-attendance",
      "staff-roll-call",
    ])

    registerSurfaces[0]?.()
    registerSurfaces[1]?.()

    expect(browser.pushState).toHaveBeenCalledOnce()
  })
})

describe("unsaved-work committed surfaces", () => {
  afterEach(() => {
    mountEffects.length = 0
    vi.unstubAllGlobals()
  })

  it("protects a committed surface that is dirty again without passing through a clean state", () => {
    const browser = stubBrowser()
    const { guards, registerSurfaces } = mountDirtySurfaces(["staff-roll-call"])
    const releaseSurface = registerSurfaces[0]?.()

    guards.get("staff-roll-call")?.navigateAfterCommit(() => {})
    browser.dispatch("popstate")
    browser.flushMicrotasks()

    // The commit's own navigation must still pass without a warning.
    const committedNavigation = leaveSiteEvent()
    browser.dispatch("beforeunload", committedNavigation)
    expect(committedNavigation.preventDefault).not.toHaveBeenCalled()

    // The coach marks another assistant coach. `isDirty` was already true and never
    // went false, so the surface re-registers with the value it had at commit.
    releaseSurface?.()
    registerSurfaces[0]?.()

    const laterNavigation = leaveSiteEvent()
    browser.dispatch("beforeunload", laterNavigation)

    expect(laterNavigation.preventDefault).toHaveBeenCalledOnce()
    expect(laterNavigation.returnValue).toBe(true)
  })
})

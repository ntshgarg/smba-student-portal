import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

// The suite has no DOM, so React never flushes mount effects by itself. The
// guard registers its surfaces from an effect, and the behaviour under test only
// appears once more than one surface is registered, so the effects are recorded
// during the static render and flushed the way a mount would.
const { mountEffects } = vi.hoisted(() => ({ mountEffects: [] as Array<() => void> }))

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react")
  return {
    ...actual,
    useEffect: (effect: () => void) => {
      mountEffects.push(effect)
    },
  }
})

import { UnsavedWorkProvider, useUnsavedWorkGuard } from "@/components/unsaved-work-guard"

type SurfaceGuard = ReturnType<typeof useUnsavedWorkGuard>

type HistoryStub = {
  back: () => void
  pushState: (state: Record<string, unknown>) => void
  state: Record<string, unknown> | null
}

function stubBrowser() {
  const listeners = new Map<string, Array<() => void>>()
  const microtasks: Array<() => void> = []
  const timers = new Map<number, () => void>()
  const back = vi.fn()
  let nextTimerId = 1

  const history: HistoryStub = {
    back,
    pushState(state) {
      history.state = state
    },
    state: null,
  }

  function addEventListener(type: string, listener: () => void) {
    listeners.set(type, [...(listeners.get(type) ?? []), listener])
  }

  vi.stubGlobal("window", {
    addEventListener,
    clearTimeout: (id: number) => timers.delete(id),
    confirm: () => true,
    history,
    location: { href: "https://smba.test/coach/onboarding" },
    queueMicrotask: (task: () => void) => microtasks.push(task),
    removeEventListener: () => {},
    setTimeout: (handler: () => void) => {
      const id = nextTimerId++
      timers.set(id, handler)
      return id
    },
  })
  vi.stubGlobal("document", { addEventListener, removeEventListener: () => {} })

  return {
    back,
    dispatch(type: string) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener()
    },
    flushMicrotasks() {
      while (microtasks.length) microtasks.shift()?.()
    },
    history,
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

function mountDirtySurfaces(scopes: string[]) {
  const guards = new Map<string, SurfaceGuard>()

  renderToStaticMarkup(
    <UnsavedWorkProvider>
      {scopes.map((scope) => (
        <DirtySurface key={scope} onReady={(guard) => guards.set(scope, guard)} scope={scope} />
      ))}
    </UnsavedWorkProvider>,
  )
  for (const effect of mountEffects.splice(0)) effect()

  return guards
}

describe("committed unsaved-work surfaces", () => {
  afterEach(() => {
    mountEffects.length = 0
    vi.unstubAllGlobals()
  })

  it("runs the committing surface's callback while another surface stays dirty", () => {
    const browser = stubBrowser()
    const guards = mountDirtySurfaces(["onboarding-assessment", "financial-plan"])
    const announceSuccess = vi.fn()

    const boundaryReleased = guards.get("onboarding-assessment")
      ?.navigateAfterCommit(announceSuccess)
    browser.flushMicrotasks()

    expect(announceSuccess).toHaveBeenCalledOnce()
    expect(boundaryReleased).toBe(false)
    expect(browser.back).not.toHaveBeenCalled()
  })

  it("releases the boundary on the last commit and runs every committed callback", () => {
    const browser = stubBrowser()
    const guards = mountDirtySurfaces(["onboarding-assessment", "financial-plan"])
    const announceSuccess = vi.fn()
    const navigateAway = vi.fn()

    guards.get("onboarding-assessment")?.navigateAfterCommit(announceSuccess)
    browser.flushMicrotasks()
    const boundaryReleased = guards.get("financial-plan")?.navigateAfterCommit(navigateAway)

    expect(boundaryReleased).toBe(true)
    expect(browser.back).toHaveBeenCalledOnce()

    browser.dispatch("popstate")
    browser.flushMicrotasks()

    expect(announceSuccess).toHaveBeenCalledOnce()
    expect(navigateAway).toHaveBeenCalledOnce()
  })

  it("navigates a sole dirty surface only after its history boundary closes", () => {
    const browser = stubBrowser()
    const guards = mountDirtySurfaces(["announcement-composer"])
    const navigateAway = vi.fn()

    const boundaryReleased = guards.get("announcement-composer")
      ?.navigateAfterCommit(navigateAway)

    expect(boundaryReleased).toBe(true)
    expect(browser.back).toHaveBeenCalledOnce()
    expect(navigateAway).not.toHaveBeenCalled()

    browser.dispatch("popstate")
    browser.flushMicrotasks()

    expect(navigateAway).toHaveBeenCalledOnce()
  })
})

"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
} from "react"

const DEFAULT_WARNING = "You have unsaved changes. Leave without saving?"
const HISTORY_BOUNDARY_KEY = "__smbaUnsavedWorkBoundary"

function scheduleCommittedNavigation(navigate: () => void) {
  window.queueMicrotask(navigate)
}

export function createCommittedNavigationCoordinator(
  schedule: (navigate: () => void) => void,
) {
  let pendingNavigation: (() => void) | null = null

  return {
    clear() {
      pendingNavigation = null
    },
    finishBoundaryRelease() {
      const navigate = pendingNavigation
      pendingNavigation = null
      if (navigate) schedule(navigate)
    },
    start({
      collapseBoundary,
      hasBoundary,
      navigate,
    }: {
      collapseBoundary: () => void
      hasBoundary: boolean
      navigate: () => void
    }) {
      if (!hasBoundary) {
        schedule(navigate)
        return
      }
      pendingNavigation = navigate
      collapseBoundary()
    },
  }
}

type DirtySurface = {
  message: string
}

type UnsavedWorkContextValue = {
  // Always schedules `navigate`. The boolean reports whether the history
  // boundary was released, which callers commonly have no reason to inspect.
  commitSurfaceAndNavigate: (id: string, navigate: () => void) => boolean
  confirmNavigation: (message?: string) => boolean
  confirmSurfaceDiscard: (id: string, message?: string) => boolean
  setSurface: (id: string, dirty: boolean, message: string) => void
  removeSurface: (id: string) => void
}

const UnsavedWorkContext = createContext<UnsavedWorkContextValue | null>(null)

function isSameDocumentAnchor(link: HTMLAnchorElement) {
  const destination = new URL(link.href, window.location.href)
  return destination.origin === window.location.origin
    && destination.pathname === window.location.pathname
    && destination.search === window.location.search
}

export function UnsavedWorkProvider({ children }: { children: React.ReactNode }) {
  const dirtySurfaces = useRef(new Map<string, DirtySurface>())
  const allowNavigation = useRef(false)
  const allowanceTimer = useRef<number | null>(null)
  const historyBoundaryActive = useRef(false)
  const historyBoundaryReleaseTimer = useRef<number | null>(null)
  const ignoreNextPopState = useRef(false)
  const committedNavigation = useRef<ReturnType<
    typeof createCommittedNavigationCoordinator
  > | null>(null)
  committedNavigation.current ??= createCommittedNavigationCoordinator(
    scheduleCommittedNavigation,
  )
  const historyBoundaryToken = useId()

  const dirtyMessage = useCallback((override?: string) => {
    const onlySurface = dirtySurfaces.current.size === 1
      ? dirtySurfaces.current.values().next().value as DirtySurface | undefined
      : undefined
    return override ?? onlySurface?.message ?? DEFAULT_WARNING
  }, [])

  const ensureHistoryBoundary = useCallback(() => {
    if (historyBoundaryReleaseTimer.current !== null) {
      window.clearTimeout(historyBoundaryReleaseTimer.current)
      historyBoundaryReleaseTimer.current = null
    }
    if (historyBoundaryActive.current || allowNavigation.current) return
    const currentState = window.history.state && typeof window.history.state === "object"
      ? window.history.state as Record<string, unknown>
      : {}
    window.history.pushState(
      { ...currentState, [HISTORY_BOUNDARY_KEY]: historyBoundaryToken },
      "",
      window.location.href,
    )
    historyBoundaryActive.current = true
  }, [historyBoundaryToken])

  const grantOneNavigation = useCallback(() => {
    allowNavigation.current = true
    if (allowanceTimer.current !== null) window.clearTimeout(allowanceTimer.current)
    allowanceTimer.current = window.setTimeout(() => {
      allowNavigation.current = false
      allowanceTimer.current = null
      // The allowance suppresses boundary creation while it lasts, so a surface
      // that became dirty inside the window got no boundary and nothing else
      // would ever give it one. The boundary follows from a surface being dirty,
      // not from when it happened to become dirty, so it is re-evaluated the
      // moment the suppression lifts.
      if (dirtySurfaces.current.size) ensureHistoryBoundary()
    }, 1_000)
  }, [ensureHistoryBoundary])

  const confirmNavigation = useCallback((message?: string) => {
    if (!dirtySurfaces.current.size || allowNavigation.current) return true
    const confirmed = window.confirm(dirtyMessage(message))
    if (confirmed) grantOneNavigation()
    return confirmed
  }, [dirtyMessage, grantOneNavigation])

  const confirmSurfaceDiscard = useCallback((id: string, message?: string) => {
    const surface = dirtySurfaces.current.get(id)
    if (!surface) return true
    return window.confirm(message ?? surface.message)
  }, [])

  const releaseHistoryBoundary = useCallback(() => {
    if (!historyBoundaryActive.current || historyBoundaryReleaseTimer.current !== null) return
    historyBoundaryReleaseTimer.current = window.setTimeout(() => {
      historyBoundaryReleaseTimer.current = null
      if (dirtySurfaces.current.size) return
      historyBoundaryActive.current = false
      if (allowNavigation.current) return
      const currentState = window.history.state as Record<string, unknown> | null
      if (currentState?.[HISTORY_BOUNDARY_KEY] !== historyBoundaryToken) return
      ignoreNextPopState.current = true
      window.history.back()
    }, 0)
  }, [historyBoundaryToken])

  const value = useMemo<UnsavedWorkContextValue>(() => ({
    commitSurfaceAndNavigate(id, navigate) {
      dirtySurfaces.current.delete(id)
      if (dirtySurfaces.current.size) {
        // Another surface still guards unsaved work, so the history boundary has
        // to stay. This surface was committed all the same, so its callback runs
        // on the same schedule it would have used had the boundary been released.
        scheduleCommittedNavigation(navigate)
        return false
      }

      if (historyBoundaryReleaseTimer.current !== null) {
        window.clearTimeout(historyBoundaryReleaseTimer.current)
        historyBoundaryReleaseTimer.current = null
      }
      committedNavigation.current?.start({
        hasBoundary: historyBoundaryActive.current,
        navigate,
        collapseBoundary() {
          historyBoundaryActive.current = false
          ignoreNextPopState.current = true
          window.history.back()
        },
      })
      return true
    },
    confirmNavigation,
    confirmSurfaceDiscard,
    removeSurface(id) {
      dirtySurfaces.current.delete(id)
      if (!dirtySurfaces.current.size) releaseHistoryBoundary()
    },
    setSurface(id, dirty, message) {
      if (dirty) {
        dirtySurfaces.current.set(id, { message })
        // Asked for on every dirty registration rather than only the first.
        // `ensureHistoryBoundary` is already idempotent — an active boundary
        // returns early — and gating on an empty map meant a surface arriving
        // while the boundary was missing could not restore it.
        ensureHistoryBoundary()
      } else {
        dirtySurfaces.current.delete(id)
        if (!dirtySurfaces.current.size) releaseHistoryBoundary()
      }
    },
  }), [
    confirmNavigation,
    confirmSurfaceDiscard,
    ensureHistoryBoundary,
    releaseHistoryBoundary,
  ])

  useEffect(() => {
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      if (!dirtySurfaces.current.size || allowNavigation.current) return
      event.preventDefault()
      event.returnValue = true
    }

    function guardLinkNavigation(event: MouseEvent) {
      if (
        event.defaultPrevented
        || event.button !== 0
        || event.metaKey
        || event.ctrlKey
        || event.shiftKey
        || event.altKey
      ) return

      const target = event.target
      if (!(target instanceof Element)) return
      const link = target.closest<HTMLAnchorElement>("a[href]")
      if (
        !link
        || link.target === "_blank"
        || link.hasAttribute("download")
        || link.dataset.unsavedWorkIgnore === "true"
        || isSameDocumentAnchor(link)
      ) return

      if (confirmNavigation()) return
      event.preventDefault()
      event.stopPropagation()
    }

    function guardMarkedSubmission(event: SubmitEvent) {
      const form = event.target
      const submitter = event.submitter
      if (!(form instanceof HTMLFormElement)) return
      const isGuarded = form.dataset.unsavedWorkNavigation === "true"
        || (submitter instanceof HTMLElement
          && submitter.dataset.unsavedWorkNavigation === "true")
      if (!isGuarded || confirmNavigation()) return
      event.preventDefault()
      event.stopPropagation()
    }

    function guardHistoryNavigation() {
      if (ignoreNextPopState.current) {
        ignoreNextPopState.current = false
        committedNavigation.current?.finishBoundaryRelease()
        return
      }
      if (
        !historyBoundaryActive.current
        || !dirtySurfaces.current.size
        || allowNavigation.current
      ) return

      if (window.confirm(dirtyMessage())) {
        grantOneNavigation()
        historyBoundaryActive.current = false
        window.history.back()
        return
      }

      const currentState = window.history.state && typeof window.history.state === "object"
        ? window.history.state as Record<string, unknown>
        : {}
      window.history.pushState(
        { ...currentState, [HISTORY_BOUNDARY_KEY]: historyBoundaryToken },
        "",
        window.location.href,
      )
      historyBoundaryActive.current = true
    }

    window.addEventListener("beforeunload", warnBeforeUnload)
    window.addEventListener("popstate", guardHistoryNavigation)
    document.addEventListener("click", guardLinkNavigation, true)
    document.addEventListener("submit", guardMarkedSubmission, true)
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload)
      window.removeEventListener("popstate", guardHistoryNavigation)
      document.removeEventListener("click", guardLinkNavigation, true)
      document.removeEventListener("submit", guardMarkedSubmission, true)
      if (allowanceTimer.current !== null) window.clearTimeout(allowanceTimer.current)
      if (historyBoundaryReleaseTimer.current !== null) {
        window.clearTimeout(historyBoundaryReleaseTimer.current)
      }
      committedNavigation.current?.clear()
    }
  }, [confirmNavigation, dirtyMessage, grantOneNavigation, historyBoundaryToken])

  return <UnsavedWorkContext.Provider value={value}>{children}</UnsavedWorkContext.Provider>
}

export function useUnsavedWorkGuard({
  isDirty,
  message = DEFAULT_WARNING,
  scope,
}: {
  isDirty: boolean
  message?: string
  scope: string
}) {
  const context = useContext(UnsavedWorkContext)
  const reactId = useId()
  const id = `${scope}:${reactId}`

  if (!context) {
    throw new Error("useUnsavedWorkGuard must be used inside UnsavedWorkProvider")
  }

  /**
   * A commit's own navigation is covered by `commitSurfaceAndNavigate`, which
   * removes the surface for exactly as long as it stays removed — until the
   * consumer registers again.
   *
   * A latch was kept here instead, set on commit and cleared only when `isDirty`
   * went false, and it suppressed every registration in between. `isDirty` is a
   * boolean, so a registration reporting dirty work after a commit cannot be
   * told apart from the work the commit saved; a surface edited again without
   * passing through a clean state therefore stayed suppressed for the rest of
   * its life. The latch could not earn that risk either: this effect only re-runs
   * when `context`, `id`, `message` or `isDirty` change, and a commit is made
   * from a dirty surface, so the one pass the latch could legitimately cover is
   * the settling pass — which reports `isDirty` false and needs no suppression.
   */
  useEffect(() => {
    context.setSurface(id, isDirty, message)
    return () => context.removeSurface(id)
  }, [context, id, isDirty, message])

  return {
    confirmDiscard: useCallback(
      (overrideMessage?: string) => context.confirmSurfaceDiscard(id, overrideMessage),
      [context, id],
    ),
    confirmNavigation: context.confirmNavigation,
    navigateAfterCommit: useCallback(
      (navigate: () => void) => context.commitSurfaceAndNavigate(id, navigate),
      [context, id],
    ),
  }
}

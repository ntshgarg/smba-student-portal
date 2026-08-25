import { readFileSync } from "node:fs"
import path from "node:path"

import { Children, isValidElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

// RouteErrorState calls useRouter(), which throws outside an app-router
// context, so the router has to be stubbed before any boundary is imported.
// Same shape as tests/finance-focused-player-record.test.tsx.
const navigation = vi.hoisted(() => ({ refresh: vi.fn() }))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: navigation.refresh }),
}))

import PlayerError from "@/app/(student)/error"
import PlayerLoading from "@/app/(student)/loading"
import PlayerFinancialsError from "@/app/(student)/player/financials/error"
import PlayerFinancialsLoading from "@/app/(student)/player/financials/loading"
import CoachError from "@/app/coach/error"
import CoachFinancialsError from "@/app/coach/financials/error"
import CoachFinancialsLoading from "@/app/coach/financials/loading"
import CoachLoading from "@/app/coach/loading"
import AppError from "@/app/error"
import GlobalError from "@/app/global-error"
import { RouteErrorState, RouteLoadingState } from "@/components/route-recovery"

type RouteErrorBoundary = (props: { error: Error; reset: () => void }) => ReactNode

type RouteLoadingBoundary = () => ReactNode

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

/**
 * Matches the copy sitting inside a live region without pinning the order the
 * attributes happen to be written in. A literal `role="status">…` would fail a
 * correct refactor: app/coach/financials/loading.tsx:16 is
 * `<p className="sr-only" role="status">`, so adding an id or reordering those
 * two props would break the assertion with byte-identical rendered behaviour.
 */
function statusRegion(status: string) {
  const copy = status.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")

  return new RegExp(`<[^>]*role="status"[^>]*>${copy}`, "u")
}

/**
 * The fault a boundary is handed. Both fields are things it must never print:
 * a message can carry a query, a path or a credential, and the digest is the
 * server-side correlation id. Short distinctive tokens rather than sentences,
 * so a leak that truncates still contains the whole marker.
 */
function fault() {
  return Object.assign(new Error("kUvJ7q"), { digest: "9Zx41m" })
}

/**
 * The suite has no DOM, so the retry button's handler is reached by walking the
 * element tree the component returns rather than by dispatching a click.
 * Calling a component as a plain function is the idiom at
 * tests/admin-preview-token.test.ts:52; it works here because RouteErrorState's
 * only hook call is the mocked useRouter.
 */
function retryHandler(node: ReactNode): (() => void) | null {
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(node)) return null
  if (node.type === "button" && node.props.onClick) return node.props.onClick

  for (const child of Children.toArray(node.props.children)) {
    const handler = retryHandler(child)
    if (handler) return handler
  }

  return null
}

const loadingBoundaries: Array<[string, RouteLoadingBoundary, string]> = [
  ["/coach", CoachLoading, "Loading Coach Workspace…"],
  ["/player", PlayerLoading, "Loading your Player Journal…"],
  ["/coach/financials", CoachFinancialsLoading, "Loading Financials…"],
  ["/player/financials", PlayerFinancialsLoading, "Loading your fee record…"],
]

const errorBoundaries: Array<[string, RouteErrorBoundary, string, string]> = [
  ["/", AppError, "Something went wrong.", "/"],
  // The root layout has already failed by the time this one renders, which
  // makes it the boundary most exposed to a detail leak and the least likely
  // to be exercised by hand.
  ["root layout", GlobalError, "The portal could not start.", "/"],
  ["/coach", CoachError, "Something went wrong.", "/coach"],
  ["/player", PlayerError, "Something went wrong.", "/player"],
  ["/coach/financials", CoachFinancialsError, "Financials are unavailable.", "/coach"],
  ["/player/financials", PlayerFinancialsError, "Fee record unavailable.", "/player"],
]

describe("authenticated route recovery", () => {
  it("serves the shared loading state as a labelled busy region", () => {
    const html = renderToStaticMarkup(
      <RouteLoadingState
        eyebrow="Coach Workspace"
        status="Loading Coach Workspace…"
        title="Opening your workspace…"
      />,
    )

    expect(html).toContain('aria-busy="true"')
    expect(html).toMatch(statusRegion("Loading Coach Workspace…"))
    expect(html).toContain("Opening your workspace…")
    // aria-labelledby only produces an accessible name if the id it points at
    // is in the same document, which reading the file could not establish.
    const labelledBy = html.match(/aria-labelledby="([^"]+)"/u)?.[1]
    expect(labelledBy).toBeTypeOf("string")
    expect(html).toContain(`id="${labelledBy}"`)
  })

  it("serves the shared error state as an alert with a retry and a way back", () => {
    const html = renderToStaticMarkup(
      <RouteErrorState
        body="Try loading it again."
        eyebrow="Coach Workspace"
        onRetry={() => {}}
        returnHref="/coach"
        returnLabel="Back to dashboard"
        title="Something went wrong."
      />,
    )

    expect(html).toContain('role="alert"')
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Try again<\/button>/u)
    expect(html).toMatch(/<a[^>]*href="\/coach"[^>]*>Back to dashboard<\/a>/u)
  })

  it("retries by refreshing the route and clearing the boundary", () => {
    const onRetry = vi.fn()
    navigation.refresh.mockClear()

    const retry = retryHandler(RouteErrorState({
      body: "Try loading it again.",
      eyebrow: "Coach Workspace",
      onRetry,
      returnHref: "/coach",
      returnLabel: "Back to dashboard",
      title: "Something went wrong.",
    }))

    expect(retry).toBeTypeOf("function")
    retry?.()

    // Reading the file proved only that the tokens router.refresh(), onRetry()
    // and onClick={retry} each appeared somewhere in it. Invoking the button's
    // own handler proves they are one handler: a stale route both re-fetches
    // its server data and clears the boundary, and neither half can be dropped
    // without this failing.
    expect(navigation.refresh).toHaveBeenCalledTimes(1)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it.each(loadingBoundaries)(
    "announces %s as busy while it loads",
    (_route, Loading, status) => {
      const html = renderToStaticMarkup(<Loading />)

      expect(html).toContain('aria-busy="true"')
      // The copy has to sit inside the live region, not merely somewhere in the
      // file: outside it, a screen reader never hears the route is loading.
      expect(html).toMatch(statusRegion(status))
    },
  )

  it.each(errorBoundaries)(
    "recovers %s with a named fault, a retry and no detail from the error",
    (_route, Boundary, heading, returnHref) => {
      const error = fault()

      const html = renderToStaticMarkup(<Boundary error={error} reset={() => {}} />)

      expect(html).toContain('role="alert"')
      expect(html).toContain(heading)
      expect(html).toContain(`href="${returnHref}"`)
      expect(html).toContain("Try again")
      expect(html).not.toContain(error.message)
      expect(html).not.toContain(error.digest)
    },
  )

  // The source-text assertions kept deliberately, first group. A static render
  // cannot see the "use client" directive, and Next accepts an error.tsx only
  // as a client component. It also cannot catch a truncated leak —
  // {error.message.slice(0, 3)} would pass the rendered guard above — so naming
  // the two fields keeps that mode covered.
  it("keeps the boundaries client components that never name the fault", () => {
    const state = source("components/route-recovery.tsx")
    const coachError = source("app/coach/error.tsx")
    const playerError = source("app/(student)/error.tsx")
    const fallback = source("app/error.tsx")
    const rootFallback = source("app/global-error.tsx")

    expect(coachError).toContain('"use client"')
    expect(playerError).toContain('"use client"')
    expect(fallback).toContain('"use client"')
    expect(rootFallback).toContain('"use client"')
    expect(state).not.toContain("error.message")
    expect(state).not.toContain("digest")
    expect(fallback).not.toContain("error.message")
    expect(fallback).not.toContain("digest")
    expect(rootFallback).not.toContain("error.message")
    expect(rootFallback).not.toContain("digest")
  })

  // Second group, and the reason the shared shell's own tests above apply to
  // these routes at all. Reuse is an identity a render cannot establish: the
  // it.each rows assert a thin subset (busy plus the status copy; alert plus a
  // heading, a return href and "Try again"), so a boundary that stops
  // delegating and inlines a plain <button onClick={reset}> keeps passing them
  // while silently dropping the router.refresh() half of the retry, the
  // panel, the <h1> and type="button". Only the file text catches that.
  it("builds these boundaries out of the shared recovery states", () => {
    expect(source("app/coach/loading.tsx")).toContain("RouteLoadingState")
    expect(source("app/(student)/loading.tsx")).toContain("RouteLoadingState")
    expect(source("app/error.tsx")).toContain("RouteErrorState")
    expect(source("app/global-error.tsx")).toContain("RouteErrorState")
    expect(source("app/coach/error.tsx")).toContain("RouteErrorState")
    expect(source("app/(student)/error.tsx")).toContain("RouteErrorState")
  })
})

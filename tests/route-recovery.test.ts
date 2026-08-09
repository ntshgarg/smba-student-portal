import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("authenticated route recovery", () => {
  it("provides accessible shared loading and recoverable error states", () => {
    const state = source("components/route-recovery.tsx")

    expect(state).toContain('aria-busy="true"')
    expect(state).toContain('role="status"')
    expect(state).toContain('role="alert"')
    expect(state).toContain("router.refresh()")
    expect(state).toContain("onRetry()")
    expect(state).toContain("onClick={retry}")
    expect(state).toContain("Try again")
    expect(state).not.toContain("error.message")
    expect(state).not.toContain("digest")
  })

  it("covers coach and player routes while retaining their workspace return paths", () => {
    const coachLoading = source("app/coach/loading.tsx")
    const coachError = source("app/coach/error.tsx")
    const playerLoading = source("app/(student)/loading.tsx")
    const playerError = source("app/(student)/error.tsx")

    expect(coachLoading).toContain("RouteLoadingState")
    expect(coachError).toContain('"use client"')
    expect(coachError).toContain('returnHref="/coach"')
    expect(coachError).toContain('title="Something went wrong."')
    expect(playerLoading).toContain("RouteLoadingState")
    expect(playerError).toContain('"use client"')
    expect(playerError).toContain('returnHref="/player"')
    expect(playerError).toContain('title="Something went wrong."')
  })

  it("keeps a parent fallback for authenticated-layout failures", () => {
    const fallback = source("app/error.tsx")

    expect(fallback).toContain('"use client"')
    expect(fallback).toContain("RouteErrorState")
    expect(fallback).toContain('returnHref="/"')
    expect(fallback).toContain('title="Something went wrong."')
    expect(fallback).not.toContain("error.message")
    expect(fallback).not.toContain("digest")
  })

  it("retains the more specific Financials boundaries", () => {
    expect(source("app/coach/financials/loading.tsx")).toContain("Loading Financials.")
    expect(source("app/coach/financials/error.tsx")).toContain("Financials are unavailable.")
    expect(source("app/(student)/player/financials/loading.tsx")).toContain("Loading your fee record.")
    expect(source("app/(student)/player/financials/error.tsx")).toContain("Fee record unavailable.")
  })
})

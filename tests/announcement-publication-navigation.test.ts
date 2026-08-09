import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it, vi } from "vitest"

import { createCommittedNavigationCoordinator } from "@/components/unsaved-work-guard"

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("committed unsaved-work navigation", () => {
  it("waits for a synthetic history boundary to close and navigates exactly once", () => {
    const scheduled: Array<() => void> = []
    const collapseBoundary = vi.fn()
    const navigate = vi.fn()
    const coordinator = createCommittedNavigationCoordinator((callback) => {
      scheduled.push(callback)
    })

    coordinator.start({ collapseBoundary, hasBoundary: true, navigate })

    expect(collapseBoundary).toHaveBeenCalledOnce()
    expect(scheduled).toEqual([])
    expect(navigate).not.toHaveBeenCalled()

    coordinator.finishBoundaryRelease()
    expect(scheduled).toHaveLength(1)
    scheduled.shift()?.()
    expect(navigate).toHaveBeenCalledOnce()

    coordinator.finishBoundaryRelease()
    expect(scheduled).toEqual([])
    expect(navigate).toHaveBeenCalledOnce()
  })

  it("navigates without touching history when no synthetic boundary exists", () => {
    const scheduled: Array<() => void> = []
    const collapseBoundary = vi.fn()
    const navigate = vi.fn()
    const coordinator = createCommittedNavigationCoordinator((callback) => {
      scheduled.push(callback)
    })

    coordinator.start({ collapseBoundary, hasBoundary: false, navigate })

    expect(collapseBoundary).not.toHaveBeenCalled()
    expect(scheduled).toHaveLength(1)
    scheduled.shift()?.()
    expect(navigate).toHaveBeenCalledOnce()
  })

  it("routes a successful publication by its canonical action result without timers", () => {
    const composer = source(
      "components/coach/announcements/announcement-composer.tsx",
    )
    const completion = composer.slice(
      composer.indexOf("function completePublication"),
      composer.indexOf("function handleServerValidation"),
    )

    expect(composer).toContain("onPublished(result.announcement.id)")
    expect(completion).toContain("navigateAfterCommit(() =>")
    expect(completion).toContain("window.location.replace(")
    expect(completion).not.toContain("setTimeout")
  })
})

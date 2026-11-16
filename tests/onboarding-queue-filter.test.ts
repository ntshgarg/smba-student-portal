import { describe, expect, it } from "vitest"

import { filterCases, nextCase } from "@/components/coach/onboarding/register/shared"
import type { PlayerOnboardingCase, PlayerOnboardingStage, PlayerOnboardingWorkspace } from "@/lib/coach/onboarding"

function person(id: string, stage: PlayerOnboardingStage) {
  return { id, stage } as PlayerOnboardingCase
}

const cases = [
  person("rohan", "request"),
  person("saanvi", "request"),
  person("ananya", "session"),
  person("aarav", "feePlan"),
]

const workspace = {
  cases,
  summary: { assessment: 0, feePlan: 1, newRequests: 2, onboarded: 36, session: 1, total: 4 },
} as PlayerOnboardingWorkspace

const ids = (list: PlayerOnboardingCase[]) => list.map((item) => item.id)

/*
 * The stage tiles filter the list in place. A filter that hid the open record
 * unmounted its form, losing whatever the coach had typed with no prompt, and
 * approving someone under "New requests" made the record vanish as they moved on.
 */
describe("onboarding queue filter", () => {
  it("shows only the chosen stage", () => {
    expect(ids(filterCases(workspace, "request", null).shownCases)).toEqual(["rohan", "saanvi"])
  })

  it("keeps the open record whatever the filter", () => {
    const { activeFilter, shownCases } = filterCases(workspace, "request", "aarav")
    expect(activeFilter).toBe("request")
    expect(ids(shownCases)).toEqual(["rohan", "saanvi", "aarav"])
  })

  it("stops filtering once the stage has emptied", () => {
    const { activeFilter, shownCases } = filterCases(workspace, "assessment", null)
    expect(activeFilter).toBeNull()
    expect(shownCases).toBe(cases)
  })

  it("opens a visible neighbour after the open record leaves", () => {
    const { shownCases } = filterCases(workspace, "request", "rohan")
    expect(nextCase(shownCases, cases, "rohan")).toEqual({ clearsFilter: false, item: cases[1] })
  })

  it("falls back to the whole queue, and drops the filter, when nobody else is visible", () => {
    const { shownCases } = filterCases(workspace, "feePlan", "aarav")
    expect(nextCase(shownCases, cases, "aarav")).toEqual({ clearsFilter: true, item: cases[2] })
  })

  it("keeps an unfiltered queue as it is", () => {
    expect(nextCase(cases, cases, "aarav")).toEqual({ clearsFilter: false, item: cases[2] })
  })
})

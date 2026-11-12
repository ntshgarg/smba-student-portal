import { describe, expect, it, vi } from "vitest"

vi.mock("@/app/coach/assessments/actions", () => ({
  discardAssessmentDraftAction: vi.fn(),
  publishAssessmentAction: vi.fn(),
  saveAssessmentDraftAction: vi.fn(),
}))

const { unconfirmedSaveNotice } = await import("@/components/assessments/assessment-form")

/**
 * M143: a save whose answer never arrived was reported as "could not be
 * saved", although the server may well have saved it. Repeating it is safe now
 * (each save carries the assessment's id), and the copy has to say both.
 */
describe("a save whose answer never arrived", () => {
  it("is not called a failure when the connection dropped", () => {
    const notice = unconfirmedSaveNotice(new TypeError("Failed to fetch"), true)

    expect(notice.message).toContain("may or may not have been saved")
    expect(notice.message).toContain("will not make a second copy")
    expect(notice.message).not.toContain("could not be saved")
  })

  it("says what to do when the device is offline", () => {
    expect(unconfirmedSaveNotice(new TypeError("Failed to fetch"), false).message)
      .toContain("This device is offline")
  })

  it("still offers signing in again for any other error", () => {
    const notice = unconfirmedSaveNotice(new Error("Unexpected response"), true)

    expect(notice.action).toEqual({ href: "/login", label: "Sign in again" })
    expect(notice.message).toContain("saving again is safe")
  })
})

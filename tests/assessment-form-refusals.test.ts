import { describe, expect, it, vi } from "vitest"

vi.mock("@/app/coach/assessments/actions", () => ({
  discardAssessmentDraftAction: vi.fn(),
  publishAssessmentAction: vi.fn(),
  saveAssessmentDraftAction: vi.fn(),
}))

const { afterRefusal } = await import("@/components/assessments/assessment-form")

type State = Parameters<typeof afterRefusal>[0]

/**
 * What the assessment form does with a refused save. The review of the first
 * fix found that the form told the coach one thing and then refused the very
 * press it had pointed them to: "publish your changes" followed by "changed in
 * another window", a count check that could never pass again on the same
 * screen, and a draft re-saved after being discarded elsewhere that ended on
 * "page not found". Each case here is the form's half of one of those.
 */
describe("a refused assessment save", () => {
  const draftId = "50000000-0000-4000-8000-000000000001"
  const saved = '{"strengths":"as saved"}'
  const edited = '{"strengths":"edited here"}'
  const state: State = {
    assessmentId: draftId,
    expectedPublishedCount: 3,
    knownDraftId: null,
    knownUpdatedAt: "2026-10-04T04:30:00.000Z",
    newAssessmentId: "50000000-0000-4000-8000-0000000000ff",
    published: false,
    saved,
  }
  const context = { firstName: "Kavya", playerId: "player-1", submitted: edited }

  it("keeps a draft discarded elsewhere under its old id, so its page still opens after the save", () => {
    const { notice, state: next } = afterRefusal(state, {
      code: "NOT_FOUND",
      message: "This assessment no longer exists.",
      ok: false,
    }, { ...context, kind: "draft" })

    expect(next).toMatchObject({
      assessmentId: null,
      knownUpdatedAt: null,
      newAssessmentId: draftId,
      saved: "",
    })
    expect(notice.message).toContain("saving again keeps it as a new draft")
  })

  it("says publishing again publishes, not that it keeps a draft, when Publish was pressed", () => {
    const { notice } = afterRefusal(state, {
      code: "NOT_FOUND",
      message: "This assessment no longer exists.",
      ok: false,
    }, { ...context, kind: "publish" })

    expect(notice.message).toContain("publishing again publishes it to Kavya as a new assessment")
    expect(notice.message).not.toContain("keeps it as a new draft")
  })

  it("lets the coach's next press replace a version saved elsewhere, and says so", () => {
    const { notice, state: next } = afterRefusal(state, {
      code: "CHANGED_ELSEWHERE",
      currentStatus: "published",
      currentUpdatedAt: "2026-10-04T05:00:00.000Z",
      message: "This assessment was published or changed in another window after you opened it.",
      ok: false,
    }, { ...context, kind: "draft" })

    // The screen stops calling it a draft, and the update it now offers goes
    // through instead of being refused as out of date.
    expect(next).toMatchObject({ knownUpdatedAt: "2026-10-04T05:00:00.000Z", published: true })
    expect(notice.message).toContain("Your changes are still here")
    expect(notice.message).toContain("Pressing Update assessment replaces that version with yours")
    // Checking the other version does not mean leaving this one.
    expect(notice.action).toMatchObject({ href: `/coach/assessments/${draftId}`, newTab: true })
  })

  it("asks a screen with no changes of its own to reload rather than save its stale copy over the newer one", () => {
    const { notice, state: next } = afterRefusal(state, {
      code: "CHANGED_ELSEWHERE",
      currentStatus: "draft",
      currentUpdatedAt: "2026-10-04T05:00:00.000Z",
      message: "This assessment was changed in another window after you opened it.",
      ok: false,
    }, { ...context, kind: "draft", submitted: saved })

    expect(next.knownUpdatedAt).toBe(state.knownUpdatedAt)
    expect(notice.message).toContain("Reload to see the latest version")
    expect(notice.action).toEqual({ href: `/coach/assessments/${draftId}`, label: "Reload" })
  })

  it("takes on the new published count once the coach has been told, so publishing again can go through", () => {
    const { notice, state: next } = afterRefusal(state, {
      code: "CONFLICT",
      currentPublishedCount: 4,
      message: "Another assessment for this player was published after you opened this one.",
      ok: false,
    }, { ...context, kind: "publish" })

    expect(next.expectedPublishedCount).toBe(4)
    expect(notice.action).toMatchObject({ href: "/coach/assessments/players/player-1", newTab: true })
  })

  it("remembers another window's draft, so publishing again goes beside it", () => {
    const blank: State = { ...state, assessmentId: null, knownUpdatedAt: null }
    const { state: next } = afterRefusal(blank, {
      code: "CONFLICT",
      currentDraftId: draftId,
      message: "This player already has a draft, perhaps from another window. Nothing was published.",
      ok: false,
    }, { ...context, kind: "publish" })

    expect(next.knownDraftId).toBe(draftId)
  })

  it("switches to Update when the server says the assessment is already published", () => {
    const { state: next } = afterRefusal({ ...state, knownUpdatedAt: null }, {
      code: "CONFLICT",
      currentStatus: "published",
      currentUpdatedAt: "2026-10-04T05:00:00.000Z",
      message: "This assessment is already published. Publish your changes to update it.",
      ok: false,
    }, { ...context, kind: "draft" })

    expect(next).toMatchObject({ knownUpdatedAt: "2026-10-04T05:00:00.000Z", published: true })
  })
})

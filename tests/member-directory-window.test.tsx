import { renderToStaticMarkup } from "react-dom/server"

import { beforeEach, describe, expect, it, vi } from "vitest"

import type { PlayerMemberRecord } from "@/lib/coach/types"

const mocks = vi.hoisted(() => ({
  archiveMember: vi.fn(),
  approveRegistration: vi.fn(),
  players: [] as unknown[],
  rejectRegistration: vi.fn(),
  routerPush: vi.fn(),
  saveMember: vi.fn(),
  search: "",
}))

vi.mock("next/navigation", () => ({
  usePathname: () => "/coach/members",
  useRouter: () => ({ push: mocks.routerPush }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}))

vi.mock("@/components/coach/coach-portal-provider", () => ({
  useMemberDirectoryPortal: () => ({
    archiveMember: mocks.archiveMember,
    approveRegistration: mocks.approveRegistration,
    pendingRegistrations: [],
    players: mocks.players,
    rejectRegistration: mocks.rejectRegistration,
    saveMember: mocks.saveMember,
    sessionAssignments: [],
    sessionSeries: [],
  }),
}))

vi.mock("@/components/unsaved-work-guard", () => ({
  useUnsavedWorkGuard: () => ({ confirmDiscard: () => true }),
}))

import { MemberDirectory } from "@/components/coach/members/member-directory"
import {
  MEMBERS_INCREMENT,
  initialMemberWindow,
  memberWindowAfterCriteriaChange,
  memberWindowAfterEditingEnds,
  memberWindowAfterReveal,
  memberWindowSummary,
  visibleMemberCount,
} from "@/components/coach/members/member-window"

function players(count: number): PlayerMemberRecord[] {
  return Array.from({ length: count }, (_, index) => {
    const serial = String(index + 1).padStart(2, "0")
    const memberId = `player-${serial}`
    return {
      member: {
        academyId: `SMBA#00${serial}`,
        fullName: `Member ${serial}`,
        id: memberId,
        initials: `M${serial}`,
        joinedAt: "2026-01-01",
        primaryContact: { name: "", phone: "", relationship: "" },
        role: "player",
      },
      training: {
        activeSessionIds: [],
        academyPlan: "weekday-3-day",
        ageGroup: "",
        batch: "Weekday",
        level: "Beginner",
        memberId,
        recordRevision: 1,
        status: "unassigned",
      },
    }
  })
}

describe("Member Directory reveal window", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.players = []
    mocks.search = ""
  })

  it("renders the first 12 filtered members and a quiet one-way reveal", () => {
    mocks.players = players(13)

    const html = renderToStaticMarkup(<MemberDirectory />)

    expect(html).toContain("Showing 12 of 13 members")
    expect(html).toContain("Member 12")
    expect(html).not.toContain("Member 13")
    expect(html).toContain("Show more members")
    expect(html).toContain('aria-controls="coach-member-results"')
  })

  it("uses the Court Register folio order for every visible roster row", () => {
    mocks.players = players(13)

    const html = renderToStaticMarkup(<MemberDirectory />)

    expect(html).toContain("Court roster register")
    expect(html.match(/coach-member-folio/g)).toHaveLength(12)
    expect(html).toMatch(/coach-member-folio[^>]*>01</u)
    expect(html).toMatch(/coach-member-folio[^>]*>12</u)
    expect(html).not.toMatch(/coach-member-folio[^>]*>13</u)
    expect(html).toContain('<th scope="col">Training</th>')
  })

  it("removes Show more when every filtered member is visible", () => {
    mocks.players = players(MEMBERS_INCREMENT)

    const html = renderToStaticMarkup(<MemberDirectory />)

    expect(html).toContain("12 members")
    expect(html).not.toContain("Show more members")
  })

  it("opens and reveals a player linked from onboarding beyond the initial window", () => {
    mocks.players = players(13)
    mocks.search = "player=player-13"

    const html = renderToStaticMarkup(<MemberDirectory />)

    expect(html).toContain("13 members")
    expect(html).toContain('id="member-details-player-13"')
    expect(html).toContain('id="member-details-title-player-13" tabindex="-1"')
    expect(html).toContain('aria-expanded="true"')
    expect(html).not.toContain("Show more members")
  })

  it("reveals the next 12 without reducing the existing window", () => {
    const initial = initialMemberWindow()
    const secondWindow = memberWindowAfterReveal(initial, 12, 40)
    const thirdWindow = memberWindowAfterReveal(secondWindow, 24, 40)

    expect(MEMBERS_INCREMENT).toBe(12)
    expect(secondWindow.visibleLimit).toBe(24)
    expect(thirdWindow.visibleLimit).toBe(36)
  })

  it("defers criteria resets while editing and keeps the active editor visible", () => {
    const revealed = memberWindowAfterReveal(initialMemberWindow(), 12, 40)
    const criteriaChanged = memberWindowAfterCriteriaChange(revealed, true)

    expect(criteriaChanged).toEqual({
      resetAfterEditing: true,
      visibleLimit: 24,
    })
    expect(visibleMemberCount(40, criteriaChanged, 30)).toBe(31)
    expect(memberWindowAfterEditingEnds(criteriaChanged)).toEqual(initialMemberWindow())
  })

  it("does not collapse a revealed window when editing ends without a criteria change", () => {
    const revealed = memberWindowAfterReveal(initialMemberWindow(), 12, 40)

    expect(memberWindowAfterEditingEnds(revealed)).toEqual(revealed)
    expect(memberWindowAfterCriteriaChange(revealed, false)).toEqual(initialMemberWindow())
  })

  it("announces visible and total results only while the list is truncated", () => {
    expect(memberWindowSummary(12, 30)).toBe("Showing 12 of 30 members")
    expect(memberWindowSummary(12, 12)).toBe("12 members")
    expect(memberWindowSummary(1, 1)).toBe("1 member")
  })
})

import { renderToStaticMarkup } from "react-dom/server"

import { beforeEach, describe, expect, it, vi } from "vitest"

import type { AcademyStaffMember, PlayerMemberRecord } from "@/lib/coach/types"
import type { MemberTrainingSummaries } from "@/lib/training/member-summaries"

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

// The record's training actions call server actions; the directory's window
// behaviour under test never reaches them.
vi.mock("@/app/coach/members/training-actions", () => ({}))
// So does a coach's "Archive coach" button.
vi.mock("@/app/coach/actions", () => ({}))

vi.mock("@/components/unsaved-work-guard", () => ({
  useUnsavedWorkGuard: () => ({ confirmDiscard: () => true }),
}))

import { MemberTrainingProvider } from "@/components/coach/members/directory/member-training-context"
import { MemberDirectory } from "@/components/coach/members/member-directory"
import { termFinishedMembersHref } from "@/components/coach/members/member-directory-query"
import {
  MEMBERS_PER_PAGE,
  initialMemberPage,
  memberPageAfterCriteriaChange,
  memberPageAfterEditingEnds,
  memberPageCount,
  memberPageNumbers,
  memberWindowSummary,
  shownMemberPage,
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
        trainingStartOn: "2026-01-01",
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
        termFinishedOn: null,
      },
    }
  })
}

/** The page as text-ish markup: a card sets the surname apart (Member <em>05</em>). */
function directoryHtml() {
  return renderToStaticMarkup(<MemberDirectory />).replace(/<\/?em>/gu, "")
}

describe("Member Directory pages", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.players = []
    mocks.search = ""
  })

  it("renders the first five filtered members and the page bar", () => {
    mocks.players = players(13)

    const html = directoryHtml()

    expect(MEMBERS_PER_PAGE).toBe(5)
    expect(html).toContain("1–5 of 13 members")
    expect(html).toContain("Member 05")
    expect(html).not.toContain("Member 06")
    expect(html.match(/class="coach-member-card-head"/g)).toHaveLength(5)
    expect(html).toContain('aria-label="Member pages"')
    expect(html).toContain('aria-current="page"')
  })

  it("opens on the page in the link", () => {
    mocks.players = players(13)
    mocks.search = "page=3"

    const html = directoryHtml()

    expect(html).toContain("11–13 of 13 members")
    expect(html).toContain("Member 11")
    expect(html).not.toContain("Member 10")
  })

  it("has no page bar when everyone fits on one page", () => {
    mocks.players = players(MEMBERS_PER_PAGE)

    const html = directoryHtml()

    expect(html).toContain("5 members")
    expect(html).not.toContain('aria-label="Member pages"')
  })

  it("opens the page holding a player linked from onboarding", () => {
    mocks.players = players(13)
    mocks.search = "player=player-13"

    const html = directoryHtml()

    expect(html).toContain("11–13 of 13 members")
    expect(html).toContain('id="member-details-player-13"')
    expect(html).toContain('id="member-details-title-player-13" tabindex="-1"')
    expect(html).toContain('aria-expanded="true"')
  })

  it("keeps the open or edited member's page, and stays in range", () => {
    expect(shownMemberPage(40, initialMemberPage(1), 30)).toBe(7)
    expect(shownMemberPage(40, initialMemberPage(3), -1)).toBe(3)
    expect(shownMemberPage(12, initialMemberPage(9), -1)).toBe(3)
    expect(memberPageCount(0)).toBe(1)
    expect(memberPageCount(41)).toBe(9)
  })

  it("defers a search or filter's return to page 1 while editing", () => {
    const third = initialMemberPage(3)
    const criteriaChanged = memberPageAfterCriteriaChange(third, true)

    expect(criteriaChanged).toEqual({ page: 3, resetAfterEditing: true })
    expect(memberPageAfterEditingEnds(criteriaChanged)).toEqual(initialMemberPage())
    expect(memberPageAfterEditingEnds(third)).toEqual(third)
    expect(memberPageAfterCriteriaChange(third, false)).toEqual(initialMemberPage())
  })

  it("offers the first, last and neighbouring page numbers", () => {
    expect(memberPageNumbers(1, 9)).toEqual([1, 2, "gap", 9])
    expect(memberPageNumbers(5, 9)).toEqual([1, "gap", 4, 5, 6, "gap", 9])
    expect(memberPageNumbers(2, 3)).toEqual([1, 2, 3])
  })

  it("names the range shown, or just the count on one page", () => {
    expect(memberWindowSummary(2, 13)).toBe("6–10 of 13 members")
    expect(memberWindowSummary(1, 5)).toBe("5 members")
    expect(memberWindowSummary(1, 1)).toBe("1 member")
  })
})

/*
 * The dashboard's "Term finished: N players to move" lands here with
 * status=finished&role=players. The list has to be the same N players: no
 * coach after them, and no term-finished player whose move or end is already
 * booked, since the to-do no longer counts them.
 */
describe("Member Directory from the dashboard's term-finished to-do", () => {
  const coach: AcademyStaffMember = {
    academyId: "SMBA-JC-6442",
    accessLevel: "junior_coach",
    activatedAt: "2026-08-27T09:10:00.000Z",
    approvedAt: "2026-08-27T08:00:00.000Z",
    fullName: "Kavya Iyer",
    id: "staff-1",
    initials: "KI",
    joinedOn: "2026-08-27",
    role: "coach",
  }

  function player(id: string, fullName: string, status: PlayerMemberRecord["training"]["status"]) {
    const [record] = players(1)
    return {
      member: { ...record.member, fullName, id },
      training: {
        ...record.training,
        activeSessionIds: status === "paused" ? [] : ["autumn"],
        memberId: id,
        status,
        termFinishedOn: status === "finished" ? "2026-10-31" : null,
      },
    } satisfies PlayerMemberRecord
  }

  function render(search: string) {
    mocks.players = [
      player("to-move", "Asha Iyer", "finished"),
      player("booked", "Ela Shah", "finished"),
      player("running", "Chitra Rao", "active"),
    ]
    mocks.search = search
    const training: MemberTrainingSummaries = {
      financeActive: false,
      nextMonthStart: "2026-12-01",
      summaries: {
        booked: {
          failed: null,
          fee: null,
          note: null,
          scheduled: {
            academyPlan: "weekday-3-day",
            batch: "Weekday",
            effectiveOn: "2026-12-01",
            id: "booked-move",
            kind: "change",
            level: "Beginner",
            monthlyFeePaise: null,
            seriesId: "season",
            stopFees: false,
            weekdays: [1],
          },
        },
        running: { failed: null, fee: null, note: null, scheduled: null },
        "to-move": { failed: null, fee: null, note: null, scheduled: null },
      },
      today: "2026-11-12",
    }
    // A card sets the surname apart (Asha <em>Iyer</em>), so names are read as text.
    return renderToStaticMarkup(
      <MemberTrainingProvider value={training}>
        <MemberDirectory staff={[coach]} />
      </MemberTrainingProvider>,
    ).replace(/<\/?em>/gu, "")
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("lists only the players still to move, without the coaches", () => {
    const html = render(new URL(termFinishedMembersHref, "https://smba.test").search)

    expect(html).toContain("Asha Iyer")
    expect(html).not.toContain("Ela Shah")
    expect(html).not.toContain("Chitra Rao")
    expect(html).not.toContain("Kavya Iyer")
    expect(html).toContain(">1 member<")
  })

  it("still shows a booked player as term finished among everyone", () => {
    const html = render("")

    expect(html).toContain("Ela Shah")
    expect(html.match(/>Term finished</gu)).toHaveLength(2)
    expect(html).toContain("Kavya Iyer")
    expect(html).toContain(">4 members<")
  })
})

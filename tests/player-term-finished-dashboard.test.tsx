import { renderToStaticMarkup } from "react-dom/server"

import { beforeEach, describe, expect, it, vi } from "vitest"

import type { PlayerAttendanceRecord } from "@/lib/types"

const mocks = vi.hoisted(() => ({
  getCurrentStudent: vi.fn(),
  getDashboard: vi.fn(),
  getPlayerFinanceDashboardSummary: vi.fn(),
  listActivePlayerAnnouncements: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND")
  },
  redirect: () => {
    throw new Error("NEXT_REDIRECT")
  },
  usePathname: () => "/player",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("@/components/dashboard/welcome-hero", () => ({
  WelcomeHero: () => <div>Player welcome</div>,
}))
vi.mock("@/components/financials/player-fee-record-card", () => ({
  PlayerFeeRecordCard: () => <div>Fee record</div>,
}))
vi.mock("@/lib/student/current-student", () => ({
  getCurrentStudent: mocks.getCurrentStudent,
}))
vi.mock("@/lib/data", () => ({
  portalRepository: { getDashboard: mocks.getDashboard },
}))
vi.mock("@/lib/finance/service", () => ({
  getPlayerFinanceDashboardSummary: mocks.getPlayerFinanceDashboardSummary,
}))
vi.mock("@/lib/announcements/queries", () => ({
  listActivePlayerAnnouncements: mocks.listActivePlayerAnnouncements,
}))

import DashboardPage from "@/app/(student)/player/page"

const attendanceRecord: PlayerAttendanceRecord = {
  adjustments: [],
  assignments: [{
    effectiveFrom: "2026-07-01",
    effectiveTo: null,
    id: "assignment-1",
    seriesId: "autumn",
    weekdays: [1],
  }],
  holidays: [],
  joinedOn: "2026-07-01",
  occurrences: [],
  records: [],
  referenceDate: "2026-11-12",
  referenceInstant: "2026-11-12T05:00:00.000Z",
  sessions: [],
  years: [2026],
}

function dashboard(termFinishedOn: string | null) {
  return {
    announcements: [],
    attendance: null,
    attendanceRecord,
    coachMessage: { coachName: "Coach", message: "Keep building your game." },
    latestAssessment: null,
    nextSession: null,
    player: {
      academyPlan: "5 days/week",
      ageGroup: "Under 13",
      currentFocus: "Current training block",
      firstName: "Mira",
      fullName: "Mira Rao",
      id: "player-2",
      initials: "MR",
      level: "Beginner",
      memberSince: "2026-07-01",
      status: "active",
      termFinishedOn,
    },
  }
}

describe("the player's dashboard after a schedule runs out", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentStudent.mockResolvedValue({
      identity: {
        academyId: "SMBA#0002",
        firstName: "Mira",
        fullName: "Mira Rao",
        initials: "MR",
        playerId: "player-2",
      },
      profile: {},
    })
    mocks.getPlayerFinanceDashboardSummary.mockResolvedValue(null)
    mocks.listActivePlayerAnnouncements.mockResolvedValue([])
  })

  it("tells the family the term finished instead of 'No upcoming session'", async () => {
    mocks.getDashboard.mockResolvedValue(dashboard("2026-10-31"))

    const html = renderToStaticMarkup(await DashboardPage())

    expect(html).toContain(
      "Your term finished on 31 October 2026. Your next schedule will appear here once your coach confirms it.",
    )
    expect(html).toContain(">Term finished<")
    expect(html).not.toContain("No upcoming session")
    // The attendance card does not read as if nothing had started.
    expect(html).not.toContain("No sessions yet this month")
    expect(html).toContain("Your term finished on 31 October 2026. Your attendance from it stays in your record.")
  })

  it("keeps today's wording while the term is still running", async () => {
    mocks.getDashboard.mockResolvedValue(dashboard(null))

    const html = renderToStaticMarkup(await DashboardPage())

    expect(html).toContain("No upcoming session")
    expect(html).toContain("No sessions yet this month")
    expect(html).not.toContain("term finished")
  })
})

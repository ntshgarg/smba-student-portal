import { renderToStaticMarkup } from "react-dom/server"

import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCurrentStudent: vi.fn(),
  getDashboard: vi.fn(),
  getPlayerFinanceDashboardSummary: vi.fn(),
  listActivePlayerAnnouncements: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT")
  }),
}))

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}))
vi.mock("@/components/dashboard/welcome-hero", () => ({
  WelcomeHero: () => <div>Player welcome remains available</div>,
}))
vi.mock("@/components/dashboard/player-attendance-card", () => ({
  PlayerAttendanceCard: () => <div>Attendance remains available</div>,
}))
vi.mock("@/components/financials/player-fee-record-card", () => ({
  PlayerFeeRecordCard: () => <div>Fee record remains available</div>,
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
import { PlayerAnnouncementsCard } from "@/components/announcements/player-announcements"
import type { AnnouncementSummary } from "@/components/announcements/types"

function announcement(overrides: Partial<AnnouncementSummary> = {}): AnnouncementSummary {
  return {
    expiresOn: null,
    id: "announcement-1",
    pinned: false,
    preview: "Training will begin at the usual time.",
    publishedAt: "2026-08-10T03:30:00.000Z",
    title: "Training update",
    ...overrides,
  }
}

describe("PlayerAnnouncementsCard", () => {
  it("renders a calm unavailable state when the announcement query fails", () => {
    const html = renderToStaticMarkup(
      <PlayerAnnouncementsCard announcements={null} />,
    )

    expect(html).toContain("Announcements unavailable")
    expect(html).toContain("Academy notices could not be loaded just now.")
    expect(html).not.toContain("href=")
    expect(html).not.toContain("Error")
  })

  it("remains silent when the announcement query succeeds with no results", () => {
    expect(renderToStaticMarkup(
      <PlayerAnnouncementsCard announcements={[]} />,
    )).toBe("")
  })

  it("retains announcement links and the archive action for populated results", () => {
    const html = renderToStaticMarkup(
      <PlayerAnnouncementsCard announcements={[
        announcement(),
        announcement({ id: "announcement-2", title: "Tournament reminder" }),
        announcement({ id: "announcement-3", title: "Holiday notice" }),
      ]} />,
    )

    expect(html).toContain('href="/player/announcements/announcement-1"')
    expect(html).toContain("Training update")
    expect(html).toContain("Tournament reminder")
    expect(html).not.toContain("Holiday notice")
    expect(html).toContain('href="/player/announcements"')
    expect(html).toContain("View all announcements")
  })
})

describe("Player Dashboard announcement failure isolation", () => {
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
    mocks.getDashboard.mockResolvedValue({
      attendance: {},
      attendanceRecord: [],
      coachMessage: "Keep building your game.",
      latestReport: null,
      nextSession: null,
      player: {
        academyPlan: "3 days/week",
        level: "Beginner",
        status: "active",
      },
    })
    mocks.getPlayerFinanceDashboardSummary.mockReturnValue(null)
  })

  it("keeps the dashboard available when the announcement query fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
    mocks.listActivePlayerAnnouncements.mockRejectedValue(new Error("database unavailable"))

    try {
      const html = renderToStaticMarkup(await DashboardPage())

      expect(html).toContain("Announcements unavailable")
      expect(html).toContain("Academy notices could not be loaded just now.")
      expect(html).toContain("Player welcome remains available")
      expect(html).toContain("Attendance remains available")
      expect(html).toContain("Monthly reports")
      expect(html).toContain("Fee record remains available")
      expect(html).not.toContain("database unavailable")
      expect(log).toHaveBeenCalledOnce()
      expect(log).toHaveBeenCalledWith("Player announcement lookup failed.")
    } finally {
      log.mockRestore()
    }
  })
})

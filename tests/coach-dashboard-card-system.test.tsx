import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/components/coach/reports/report-resume", () => ({
  useReportResume: () => ({ resumePoint: null }),
}))

import { AnnouncementCard } from "@/components/coach/announcements/announcement-card"
import { AttendanceCard } from "@/components/coach/attendance-card"
import { CoachDashboardStack } from "@/components/coach/dashboard-card"
import { FinancialsCard } from "@/components/coach/financials/financials-card"
import { MembersCard } from "@/components/coach/members-card"
import { PlayerOnboardingCard } from "@/components/coach/player-onboarding-card"
import { ReportsCard } from "@/components/coach/reports-card"
import { SessionsCard } from "@/components/coach/sessions-card"

function renderDashboard() {
  return renderToStaticMarkup(
    <CoachDashboardStack id="attendance">
      <AttendanceCard scheduleCount={12} />
      <PlayerOnboardingCard summary={{
        assessment: 3,
        feePlan: 1,
        newRequests: 2,
        session: 1,
        total: 7,
      }} />
      <SessionsCard nextSessionLabel="Beginner · Weekday · 6–7 am" todaySessionCount={8} />
      <ReportsCard activePlayerIds={["player-1", "player-2"]} completedCount={1} month="2026-07" />
      <FinancialsCard
        active
        attentionCount={14}
        outstandingPaise={4_750_000}
        period="2026-08"
        preparation={{ alreadyPrepared: 8, ready: 0 }}
      />
      <AnnouncementCard activeCount={0} />
      <MembersCard memberCount={39} />
    </CoachDashboardStack>,
  )
}

describe("coach dashboard Court Operations Board", () => {
  it("keeps the seven workflows in one accessible responsive-grid order", () => {
    const html = renderDashboard()
    const orderedAreas = [
      "attendance",
      "onboarding",
      "sessions",
      "reports",
      "financials",
      "announcements",
      "members",
    ]
    let previousIndex = -1

    expect(html).toContain("data-coach-dashboard-grid=\"true\"")
    for (const area of orderedAreas) {
      const index = html.indexOf(`data-area="${area}"`)
      expect(index).toBeGreaterThan(previousIndex)
      previousIndex = index
    }

    expect(html.match(/<a /g)).toHaveLength(16)
    expect(html).toContain('id="onboarding"')
    expect(html).toContain('id="attendance"')
    expect(html).toContain('role="group" aria-label="Players"')
    expect(html).toContain('role="group" aria-label="Staff"')
  })

  it("renders the selected ticket hierarchy with real operational states", () => {
    const html = renderDashboard()

    expect(html).toContain("Player &amp; staff registers")
    expect(html).toContain("7 people need a next step")
    expect(html).toContain("7 in progress")
    expect(html).toContain("New requests")
    expect(html).toContain("Assessment")
    expect(html).toContain("Session")
    expect(html).toContain("Fee Plan")
    expect(html).toContain("Academy onboarding")
    expect(html).toContain('href="/coach/onboarding">Open onboarding')
    expect(html).toContain("12 schedules")
    expect(html).toContain("Training calendar")
    expect(html).toContain("8 today")
    expect(html).toContain("1 of 2 published")
    expect(html).toContain("1 outstanding")
    expect(html).toContain("₹47,500 outstanding")
    expect(html).toContain("14 attention")
    expect(html).toContain("Notice board is clear")
    expect(html).toContain("39 enrolled members")
    expect(html).toContain("Approved players and staff, with their training and contact records.")
    expect(html).not.toContain("Roster current")
    expect(html).not.toContain("The academy directory is up to date.")
    expect(html).not.toContain("registrations await approval")
  })

  it("derives the Members status and detail from the enrolled member count", () => {
    const populated = renderToStaticMarkup(<MembersCard memberCount={39} />)
    const empty = renderToStaticMarkup(<MembersCard memberCount={0} />)

    expect(populated).toContain("Clear")
    expect(populated).toContain("39 enrolled members")
    expect(empty).toContain("Setup")
    expect(empty).toContain("0 enrolled members")
    expect(empty).toContain("Approved players and staff appear here once onboarding is complete.")
    expect(empty).not.toContain("up to date")
  })

  it.each([
    [4, "Beginner · Weekday · 6–7 am", "4 today", "4 sessions today"],
    [0, "Beginner · Weekday · 6–7 am", "Clear", "Next · Beginner · Weekday · 6–7 am"],
    [0, null, "Setup", "No training scheduled yet."],
  ] as const)(
    "preserves the Sessions priority branches",
    (todaySessionCount, nextSessionLabel, status, detail) => {
      const html = renderToStaticMarkup(
        <SessionsCard
          nextSessionLabel={nextSessionLabel}
          todaySessionCount={todaySessionCount}
        />,
      )

      expect(html).toContain(status)
      expect(html).toContain(detail)
      expect(html).toContain('href="/coach/calendar"')
      expect(html).toContain('href="/coach/schedules/new"')
      expect(html).toContain('href="/coach/schedules"')
    },
  )

  it("keeps the Financials inactive state single-purpose", () => {
    const html = renderToStaticMarkup(
      <FinancialsCard
        active={false}
        attentionCount={0}
        outstandingPaise={0}
        period="2026-08"
        preparation={{ alreadyPrepared: 0, ready: 0 }}
      />,
    )

    expect(html).toContain("Financial records are not set up")
    expect(html).toContain("Set up Financials")
    expect(html).toContain('href="/coach/financials?period=2026-08"')
    expect(html).not.toContain("Record payment")
    expect(html).not.toContain("Fee records are ready to review")
  })
})

import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { AnnouncementCard } from "@/components/coach/announcements/announcement-card"
import { AttendanceCard } from "@/components/coach/attendance-card"
import { CoachDashboardStack } from "@/components/coach/dashboard-card"
import { FinancialsCard } from "@/components/coach/financials/financials-card"
import { MembersCard } from "@/components/coach/members-card"
import { PlayerOnboardingCard } from "@/components/coach/player-onboarding-card"
import { AssessmentsCard } from "@/components/coach/assessments-card"
import { SessionsCard } from "@/components/coach/sessions-card"

function renderDashboard() {
  return renderToStaticMarkup(
    <CoachDashboardStack id="attendance">
      <AttendanceCard
        dateLabel="Monday, 16 November"
        makeupsToReview={1}
        sessions={{ marked: 3, total: 10 }}
        staff={{ marked: 2, total: 2 }}
      />
      <PlayerOnboardingCard summary={{
        assessment: 3,
        feePlan: 1,
        newRequests: 2,
        onboarded: 1,
        session: 1,
        total: 7,
      }} />
      <FinancialsCard
        active
        attentionCount={14}
        outstandingPaise={4_750_000}
        overdueCount={4}
        period="2026-08"
        preparation={{ alreadyPrepared: 8, ready: 0, waitingForChange: 0 }}
        setupRequiredCount={0}
      />
      <SessionsCard nextSessionLabel="Beginner · Weekday · 6–7 am" todaySessionCount={8} />
      <AssessmentsCard assessedCount={1} draftCount={0} playerCount={2} />
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
      "financials",
      "sessions",
      "reports",
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

    // 13 action buttons, plus the overdue stamp, which opens the late payers
    expect(html.match(/<a class="[^"]*_action_/g)).toHaveLength(13)
    expect(html.match(/<a /g)).toHaveLength(14)
    expect(html).toContain('id="onboarding"')
    expect(html).toContain('id="attendance"')
    expect(html).toContain('aria-label="Attendance actions"')
  })

  it("renders the selected ticket hierarchy with real operational states", () => {
    const html = renderDashboard()

    expect(html).toContain("3 of 10 sessions marked")
    expect(html).toContain("Monday, 16 November · staff roll call done")
    expect(html).toContain("7 sessions left today")
    expect(html).toContain("7 people need a next step")
    // the 2 new requests are waiting on the head coach, so they lead the stamp
    expect(html).toContain("2 waiting")
    expect(html).not.toContain("7 in progress")
    expect(html).toContain("New requests")
    expect(html).toContain("Assessment")
    expect(html).toContain("Session")
    expect(html).toContain("Fee Plan")
    expect(html).toContain(">Onboarding</h2>")
    expect(html).toContain("1 onboarded so far")
    expect(html).toContain('href="/coach/onboarding">Open onboarding')
    expect(html).not.toContain("will be removed")
    expect(html).toContain("Training calendar")
    expect(html).toContain("8 today")
    expect(html).toContain("1 of 2 assessed")
    expect(html).toContain("Assess a player whenever you choose.")
    expect(html).toContain("₹47,500 outstanding")
    expect(html).toContain("4 overdue")
    expect(html).not.toContain("14 attention")
    expect(html).toContain("Notice board is clear")
    expect(html).toContain("39 enrolled players")
    expect(html).toContain("Approved players and staff, with their training and contact records.")
    expect(html).not.toContain("Roster current")
    expect(html).not.toContain("The academy directory is up to date.")
    expect(html).not.toContain("registrations await approval")
  })

  it("opens the three Attendance tabs and counts today's registers", () => {
    const html = renderToStaticMarkup(
      <AttendanceCard
        dateLabel="Monday, 16 November"
        makeupsToReview={2}
        sessions={{ marked: 4, total: 10 }}
        staff={{ marked: 1, total: 2 }}
      />,
    )
    const links = [...html.matchAll(/<a class="[^"]*" href="([^"]+)">([^<]+)</g)]
      .map((match) => [match[1], match[2].replace("&#x27;", "'")])

    expect(links).toEqual([
      ["/coach/attendance/players/record", "Mark today's attendance"],
      ["/coach/attendance/players/register", "Register"],
      ["/coach/attendance/adjustments", "Make-ups"],
    ])
    expect(html).toContain('id="attendance-card-title"')
    expect(html).toContain("4 of 10 sessions marked")
    expect(html).toContain("Monday, 16 November · staff not marked yet")
    expect(html).toContain("6 sessions left today")
    expect(html).toContain('data-tone="attention"')
    expect(html).toContain("width:40%")
    expect(html).toContain("<dt>Sessions</dt><dd>4/10</dd>")
    expect(html).toContain("<dt>Staff</dt><dd>1/2</dd>")
    expect(html).toContain("<dt>Make-ups to review</dt><dd>2</dd>")
  })

  it("says All marked once today's registers are done, and stays quiet with no sessions", () => {
    const done = renderToStaticMarkup(
      <AttendanceCard
        dateLabel="Monday, 16 November"
        makeupsToReview={1}
        sessions={{ marked: 5, total: 5 }}
        staff={{ marked: 2, total: 2 }}
      />,
    )
    const empty = renderToStaticMarkup(
      <AttendanceCard
        dateLabel="Sunday, 15 November"
        makeupsToReview={0}
        sessions={{ marked: 0, total: 0 }}
        staff={{ marked: 0, total: 0 }}
      />,
    )

    expect(done).toContain("5 of 5 sessions marked")
    expect(done).toContain("All marked")
    expect(done).not.toContain("left today")
    expect(done).not.toContain("primaryAction")
    expect(done).toContain("<dt>Make-up to review</dt><dd>1</dd>")
    expect(empty).toContain("No sessions today")
    expect(empty).not.toMatch(/class="[^"]*status/)
    expect(empty).toContain(">Sunday, 15 November<")
  })

  it("derives the Members status and detail from the enrolled member count", () => {
    const populated = renderToStaticMarkup(<MembersCard memberCount={39} />)
    const empty = renderToStaticMarkup(<MembersCard memberCount={0} />)

    // nothing can be outstanding in a directory, so a populated one has no stamp
    expect(populated).not.toContain("Clear")
    expect(populated).toContain("39 enrolled players")
    expect(empty).toContain("Setup")
    expect(empty).toContain("0 enrolled players")
    expect(empty).toContain("Players appear here once their onboarding is complete.")
    expect(empty).not.toContain("up to date")
  })

  it.each([
    [4, "Beginner · Weekday · 6–7 am", "4 today", "4 sessions today"],
    [0, "Beginner · Weekday · 6–7 am", null, "Next · Beginner · Weekday · 6–7 am"],
    [0, null, "Setup", "No training scheduled."],
  ] as const)(
    "preserves the Sessions priority branches",
    (todaySessionCount, nextSessionLabel, status, detail) => {
      const html = renderToStaticMarkup(
        <SessionsCard
          nextSessionLabel={nextSessionLabel}
          todaySessionCount={todaySessionCount}
        />,
      )

      if (status) expect(html).toContain(status)
      else expect(html).not.toMatch(/status/)
      expect(html).toContain(detail)
      expect(html).toContain('href="/coach/calendar"')
      expect(html).toContain('href="/coach/schedules/new"')
      expect(html).toContain('href="/coach/schedules"')
    },
  )

  it("shows the exact outstanding balance rather than rounding it up", () => {
    /* The card carried its own `maximumFractionDigits: 0` formatter, so this
       balance read `₹1,235` on the dashboard and `₹1,234.56` one tap deeper —
       the first money figure the coach sees, overstating what a parent owes. */
    const html = renderToStaticMarkup(
      <FinancialsCard
        active
        attentionCount={1}
        outstandingPaise={123_456}
        overdueCount={1}
        period="2026-08"
        preparation={{ alreadyPrepared: 1, ready: 0, waitingForChange: 0 }}
        setupRequiredCount={0}
      />,
    )

    expect(html).toContain("₹1,234.56 outstanding")
    expect(html).not.toContain("₹1,235")
  })

  it("fills only the actions for something waiting on the coach", () => {
    const html = renderDashboard()
    const primary = [...html.matchAll(/<a class="[^"]*primaryAction[^"]*" href="([^"]+)"/g)].map((match) => match[1])

    expect(primary).toEqual([
      "/coach/attendance/players/record",
      "/coach/onboarding",
      "/coach/financials/record",
    ])
  })

  it("sums up the fee month: fees to issue in grey, late payers in red", () => {
    const html = renderToStaticMarkup(
      <FinancialsCard
        active
        attentionCount={31}
        outstandingPaise={6_450_000}
        overdueCount={4}
        period="2026-11"
        preparation={{ alreadyPrepared: 20, ready: 12, waitingForChange: 0 }}
        setupRequiredCount={2}
      />,
    )
    const stamps = [...html.matchAll(/<(?:span|a) class="[^"]*status[^"]*"( data-tone="attention")?[^>]*>([^<]+)</g)]
      .map((match) => `${match[2]}${match[1] ? " (red)" : ""}`)

    expect(stamps).toEqual(["12 to issue", "4 overdue (red)"])
    // each stamp opens the list behind its count
    expect(html).toContain('href="/coach/financials/records?view=fees&amp;mode=monthly&amp;period=2026-11&amp;status=not_prepared"')
    // the spoken name starts with the visible words, so voice control can say "click 12 to issue"
    expect(html).toContain('aria-label="12 to issue: show the November fees not yet issued"')
    expect(html).toContain('href="/coach/financials/record?scope=overdue"')
    expect(html).toContain('aria-label="4 overdue: show these players"')
    expect(html).toContain("November fees ready to issue · 2 players without a fee plan")
    expect(html).not.toContain("31")
  })

  it("leaves the stamp off a card with nothing outstanding", () => {
    const quiet = [
      <AssessmentsCard key="a" assessedCount={0} draftCount={0} playerCount={32} />,
      <AnnouncementCard key="b" activeCount={0} />,
      <MembersCard key="c" memberCount={39} />,
      <FinancialsCard key="d" active attentionCount={0} outstandingPaise={0} overdueCount={0} period="2026-08" preparation={{ alreadyPrepared: 8, ready: 0, waitingForChange: 0 }} setupRequiredCount={0} />,
    ]
    for (const card of quiet) expect(renderToStaticMarkup(card)).not.toMatch(/class="[^"]*status/)
    expect(renderToStaticMarkup(<AssessmentsCard assessedCount={0} draftCount={2} playerCount={32} />)).toContain("2 drafts")
  })

  it("keeps the Financials inactive state single-purpose", () => {
    const html = renderToStaticMarkup(
      <FinancialsCard
        active={false}
        attentionCount={0}
        outstandingPaise={0}
        overdueCount={0}
        period="2026-08"
        preparation={{ alreadyPrepared: 0, ready: 0, waitingForChange: 0 }}
        setupRequiredCount={0}
      />,
    )

    expect(html).toContain("Financial records are not set up")
    expect(html).toContain("Set up Financials")
    expect(html).toContain('href="/coach/financials?period=2026-08"')
    expect(html).not.toContain("Record payment")
    expect(html).not.toContain("Fee records are ready to review")
  })

  it("warns the head coach about join requests about to be removed, and points to onboarding", () => {
    const summary = { assessment: 0, feePlan: 0, newRequests: 0, onboarded: 4, session: 0, total: 0 }
    const html = renderToStaticMarkup(<PlayerOnboardingCard expiringRequests={3} summary={summary} />)
    expect(html).toContain("3 join requests will be removed within 7 days.")
    expect(html).toMatch(/class="[^"]*primaryAction[^"]*" href="\/coach\/onboarding">Open onboarding/u)
    expect(renderToStaticMarkup(<PlayerOnboardingCard expiringRequests={1} summary={summary} />))
      .toContain("1 join request will be removed within 7 days. Decide it, or undo a rejection.")
  })
})

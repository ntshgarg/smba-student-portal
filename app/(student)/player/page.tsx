import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ArrowUpRight } from "lucide-react"

import { PlayerAnnouncementsCard } from "@/components/announcements/player-announcements"
import { PlayerAttendanceCard } from "@/components/dashboard/player-attendance-card"
import { WelcomeHero } from "@/components/dashboard/welcome-hero"
import { PlayerFeeRecordCard } from "@/components/financials/player-fee-record-card"
import { Reveal } from "@/components/reveal"
import { portalRepository } from "@/lib/data"
import { publicSiteUrl } from "@/lib/config"
import { getPlayerFinanceDashboardSummary } from "@/lib/finance/service"
import { formatSessionDate } from "@/lib/format"
import { currentGreeting } from "@/lib/greeting"
import { listActivePlayerAnnouncements } from "@/lib/announcements/queries"
import { getCurrentStudent } from "@/lib/student/current-student"
import { describeFailureCause } from "@/lib/telemetry/failure-cause"

function loadFeeSummary(playerId: string) {
  try {
    return getPlayerFinanceDashboardSummary(playerId)
  } catch {
    return null
  }
}

async function loadAnnouncements(playerId: string) {
  try {
    return await listActivePlayerAnnouncements(playerId)
  } catch (error) {
    console.error("Player announcement lookup failed.", {
      cause: describeFailureCause(error),
    })
    return null
  }
}

export default async function DashboardPage() {
  const student = await getCurrentStudent()
  const [dashboard, feeSummary, announcements] = student
      ? await Promise.all([
        portalRepository.getDashboard(student.identity.playerId),
        loadFeeSummary(student.identity.playerId),
        loadAnnouncements(student.identity.playerId),
      ])
    : [null, null, null]

  if (!student) redirect("/login")
  if (!dashboard) notFound()

  const session = dashboard.nextSession
    ? formatSessionDate(dashboard.nextSession.startsAt)
    : null
  const playerState = dashboard.player.level === "Assessment pending"
    ? "assessment-pending"
    : dashboard.player.status === "paused"
      ? "paused"
      : dashboard.player.status === "unassigned"
        ? "schedule-pending"
        : "active"
  const scrollLabel = {
    "assessment-pending": "Your starting point",
    "schedule-pending": "Your training plan",
    active: "Your training week",
    paused: "Your training record",
  }[playerState]
  const sessionDateParts = session?.date.split(" ") ?? []
  const sessionStamp = session
    ? `${session.weekday.slice(0, 3)} · ${sessionDateParts[0]} ${sessionDateParts[1]?.slice(0, 3) ?? ""}`.trim()
    : playerState === "paused" ? "Paused" : "Pending"

  return (
    <>
      <WelcomeHero
        student={student.identity}
        coachMessage={dashboard.coachMessage}
        greeting={currentGreeting()}
        scrollLabel={scrollLabel}
      />

      <section
        id="training-week"
        className="dashboard-section player-ticket-dashboard page-shell"
        aria-labelledby="player-dashboard-records"
      >
        <h2 id="player-dashboard-records" className="sr-only">
          Training and academy records
        </h2>
        <div className="dashboard-grid">
          <Reveal
            className={`session-card dashboard-card player-ticket-card player-ticket-session${dashboard.nextSession ? "" : " is-empty"}`}
            delay={0.04}
          >
            <header className="session-card-header player-ticket-masthead">
              <h3 className="player-ticket-title">Next session</h3>
              <span className="player-ticket-context">{sessionStamp}</span>
            </header>
            {dashboard.nextSession && session ? (
              <>
                <div className="session-moment">
                  <time dateTime={dashboard.nextSession.startsAt}>
                    <span className="session-time">{session.time}</span>
                    <span className="session-date">{session.weekday}, {session.date}</span>
                  </time>
                </div>
                <p className="session-context">
                  {dashboard.nextSession.trainingFocus} · {dashboard.nextSession.batch}
                </p>
                <p className="session-meta">
                  <span>{dashboard.nextSession.durationMinutes} minutes</span>
                  <span>{dashboard.nextSession.venue}</span>
                </p>
                <p className="session-arrival">{dashboard.nextSession.arrivalNote}</p>
              </>
            ) : (
              <>
                <h3 className="empty-card-title">
                  {playerState === "assessment-pending"
                    ? "Assessment pending"
                    : playerState === "schedule-pending"
                      ? "Schedule pending"
                      : playerState === "paused"
                        ? "Training paused"
                        : "No upcoming session"}
                </h3>
                <p className="empty-card-copy">
                  {playerState === "assessment-pending"
                    ? "Your coach will add the first session after your assessment."
                    : playerState === "schedule-pending"
                      ? "Your coach is preparing your first training schedule."
                      : playerState === "paused"
                        ? "Your next session will appear when training resumes."
                        : "Your next session will appear here as soon as it is scheduled."}
                </p>
                {playerState === "assessment-pending" ? (
                  <a className="empty-card-link" href={`${publicSiteUrl}#trial`}>
                    Arrange your assessment
                    <ArrowUpRight aria-hidden="true" />
                  </a>
                ) : null}
              </>
            )}
          </Reveal>

          <PlayerAttendanceCard
            attendance={dashboard.attendance}
            playerState={playerState}
            record={dashboard.attendanceRecord}
          />

          <Reveal
            className="latest-report-card dashboard-card player-ticket-card player-ticket-record-card player-ticket-report"
            delay={0.08}
          >
            <header className="player-ticket-masthead">
              <h3 className="player-ticket-title">Monthly reports</h3>
              <span className="player-ticket-context">
                {dashboard.latestReport?.monthLabel ?? "Record"}
              </span>
            </header>
            <div className="player-ticket-record-primary">
              <strong className="player-ticket-record-value">
                {dashboard.latestReport ? "Latest feedback" : "Your development record"}
              </strong>
              <p className="player-ticket-record-copy">
                {dashboard.latestReport
                  ? "Read your coach’s latest report and follow your development over time."
                  : "Your coach’s feedback will appear here after your first month of training."}
              </p>
            </div>
            <Link className="player-ticket-action" href="/player/reports">
              <span>Open report records</span>
              <ArrowUpRight aria-hidden="true" />
            </Link>
          </Reveal>

          <PlayerFeeRecordCard summary={feeSummary} />

          <PlayerAnnouncementsCard announcements={announcements} />
        </div>

        <Reveal className="player-profile-reveal" delay={0.1}>
          <dl className="player-profile-ledger" aria-label="Player profile">
            <div>
              <dt>Player</dt>
              <dd>{student.identity.fullName}</dd>
            </div>
            <div>
              <dt>Level</dt>
              <dd>{dashboard.player.level}</dd>
            </div>
            <div>
              <dt>Academy plan</dt>
              <dd>{dashboard.player.academyPlan}</dd>
            </div>
          </dl>
        </Reveal>
      </section>
    </>
  )
}

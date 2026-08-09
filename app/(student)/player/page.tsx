import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import {
  ArrowRight,
  CalendarDays,
  FileText,
} from "lucide-react"

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
  } catch {
    console.error("Player announcement lookup failed.")
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
  const sectionCopy = {
    "assessment-pending": {
      eyebrow: "Your starting point",
      title: "Begin with clarity.",
      body: "After your assessment, your level, Academy Plan and first sessions will appear here.",
    },
    "schedule-pending": {
      eyebrow: "Your training plan",
      title: "Your plan is in place.",
      body: "Your first session will appear once your coach confirms the schedule.",
    },
    active: {
      eyebrow: "Your training week",
      title: "Everything in view.",
      body: "Your next session, attendance and coach reports stay together here.",
    },
    paused: {
      eyebrow: "Your training record",
      title: "Everything stays in place.",
      body: "Your attendance and coach reports remain available while training is paused.",
    },
  }[playerState]

  return (
    <>
      <WelcomeHero
        student={student.identity}
        coachMessage={dashboard.coachMessage}
        greeting={currentGreeting()}
        scrollLabel={sectionCopy.eyebrow}
      />

      <section id="training-week" className="dashboard-section page-shell">
        <Reveal className="dashboard-heading">
          <div>
            <p className="eyebrow">{sectionCopy.eyebrow}</p>
            <h2>{sectionCopy.title}</h2>
          </div>
          <p>
            {sectionCopy.body}
          </p>
        </Reveal>

        <div className="dashboard-grid">
          <Reveal
            className={`session-card dashboard-card${dashboard.nextSession ? "" : " is-empty"}`}
            delay={0.04}
          >
            <div className="session-card-header">
              <div className="card-icon"><CalendarDays aria-hidden="true" /></div>
              <p className="card-label">Next session</p>
            </div>
            {dashboard.nextSession && session ? (
              <>
                <h3 className="session-moment">
                  <time dateTime={dashboard.nextSession.startsAt}>
                    <span className="session-time">{session.time}</span>
                    <span className="session-date">{session.weekday}, {session.date}</span>
                  </time>
                </h3>
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
                    <ArrowRight aria-hidden="true" />
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

          <PlayerAnnouncementsCard announcements={announcements} />

          <Reveal className="latest-report-card dashboard-card" delay={0.08}>
            <Link
              className="report-primary-link"
              href="/player/reports"
            >
              <div>
                <div className="report-card-header">
                  <span className="card-icon" aria-hidden="true">
                    <FileText />
                  </span>
                  <p className="card-label">
                    {dashboard.latestReport
                      ? `Latest feedback · ${dashboard.latestReport.monthLabel}`
                      : "Your development record"}
                  </p>
                </div>
                <h3>Monthly reports</h3>
                <p>
                  {dashboard.latestReport
                    ? "Read your coach’s latest report and follow your development over time."
                    : "Your coach’s feedback will appear here after your first month of training."}
                </p>
              </div>
              <span className="report-arrow" aria-hidden="true">
                <ArrowRight />
              </span>
            </Link>
          </Reveal>

          <PlayerFeeRecordCard summary={feeSummary} />
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

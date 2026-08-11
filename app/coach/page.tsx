import { redirect } from "next/navigation"

import { AttendanceCard } from "@/components/coach/attendance-card"
import { AnnouncementCard } from "@/components/coach/announcements/announcement-card"
import { CoachWelcomeHero } from "@/components/coach/coach-welcome-hero"
import { CoachDashboardStack } from "@/components/coach/dashboard-card"
import { FinancialsCard } from "@/components/coach/financials/financials-card"
import {
  JuniorCoachAttendanceCard,
  type JuniorCoachAttendanceView,
} from "@/components/coach/junior-coach-attendance-card"
import { JuniorCoachWelcomeHero } from "@/components/coach/junior-coach-welcome-hero"
import { MembersCard } from "@/components/coach/members-card"
import { ReportsCard } from "@/components/coach/reports-card"
import { SessionsCard } from "@/components/coach/sessions-card"
import { requireCoachPage } from "@/lib/auth/current-coach"
import { listPendingRegistrations } from "@/lib/auth/account-service"
import { listCoachAnnouncements } from "@/lib/announcements/queries"
import { getIndiaDateKey } from "@/lib/coach/attendance-rules"
import {
  getCoachSessionSnapshot,
  listOperationalPlayerRecords,
  listCoachMonthlyReports,
} from "@/lib/coach/database"
import {
  getCoachReportState,
  getLatestCompletedReportMonth,
} from "@/lib/coach/report-utils"
import {
  getStaffAttendanceSummary,
  listStaffAttendanceRecords,
} from "@/lib/coach/staff-attendance"
import {
  getCoachFinanceDashboardSummary,
  getFinanceActivation,
} from "@/lib/finance/service"
import {
  academyTimeInputValue,
  formatAcademyDate,
  formatDateKey,
  formatAcademyTime,
  getAcademyMonthKey,
  formatSessionLabel,
} from "@/lib/format"
import { currentGreeting } from "@/lib/greeting"
import { resolveNextScheduledOccurrence } from "@/lib/sessions/domain"

export const metadata = {
  title: "Coach dashboard",
}

type CoachDashboardSearchParams = {
  adjustment?: string | string[]
  attendance?: string | string[]
  player?: string | string[]
}

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function CoachDashboardPage({
  searchParams,
}: {
  searchParams: Promise<CoachDashboardSearchParams>
}) {
  const query = await searchParams
  const attendancePanel = firstQueryValue(query.attendance)
  const initialAdjustmentId = firstQueryValue(query.adjustment)
  const initialPlayerId = firstQueryValue(query.player)
  const { access, identity } = await requireCoachPage()

  if (access.accessLevel === "junior_coach") {
    const now = new Date()
    const referenceDate = getIndiaDateKey(now)
    const currentYear = Number(referenceDate.slice(0, 4))
    const years = [currentYear - 1, currentYear, currentYear + 1]
    const month = referenceDate.slice(0, 7)
    const attendanceInput = {
      requesterAccountId: identity.subjectId,
      coachAccountId: identity.subjectId,
      from: `${month}-01`,
      to: referenceDate,
    }
    const summary = getStaffAttendanceSummary(attendanceInput)
    const records = listStaffAttendanceRecords({
      requesterAccountId: identity.subjectId,
      coachAccountId: identity.subjectId,
      from: `${years[0]}-01-01`,
      to: `${years[years.length - 1]}-12-31`,
    })
    const attendance: JuniorCoachAttendanceView = {
      joinedOn: access.joinedOn,
      monthLabel: formatDateKey(`${month}-01`, {
        day: undefined,
        month: "long",
        weekday: undefined,
        year: "numeric",
      }),
      referenceDate,
      records: records.map((record) => ({
        choice: record.choice,
        dateKey: record.dateKey,
      })),
      summary,
      years,
    }

    return (
      <>
        <JuniorCoachWelcomeHero
          coachName={identity.firstName}
          greeting={currentGreeting()}
        />
        <JuniorCoachAttendanceCard attendance={attendance} />
      </>
    )
  }

  if (attendancePanel === "register") redirect("/coach/attendance/players/register")
  if (attendancePanel === "reschedule" || initialAdjustmentId || initialPlayerId) {
    const adjustmentQuery = new URLSearchParams()
    if (initialAdjustmentId) adjustmentQuery.set("adjustment", initialAdjustmentId)
    if (initialPlayerId) adjustmentQuery.set("player", initialPlayerId)
    const search = adjustmentQuery.toString()
    redirect(`/coach/attendance/adjustments${search ? `?${search}` : ""}`)
  }

  const now = new Date()
  const today = getIndiaDateKey(now)
  const sessionSnapshot = getCoachSessionSnapshot(today)
  const series = sessionSnapshot.sessionSeries
  const scheduledSessions = sessionSnapshot.sessionOccurrences
    .filter((occurrence) => occurrence.status === "scheduled")
  const todaySessions = scheduledSessions.filter((occurrence) => (
    occurrence.occurrenceDate === today
  ))
  const nextScheduledSession = scheduledSessions.find((occurrence) => (
    occurrence.occurrenceDate >= today
  ))
  const nextScheduledSeries = nextScheduledSession
    ? series.find((item) => item.id === nextScheduledSession.seriesId)
    : null
  const nextSessionLabel = nextScheduledSession && nextScheduledSeries
    ? formatSessionLabel({
        programme: nextScheduledSeries.programme,
        batch: nextScheduledSeries.batch,
        startTime: academyTimeInputValue(nextScheduledSession.startsAt),
        durationMinutes: nextScheduledSession.durationMinutes,
      })
    : null
  const nextOccurrence = resolveNextScheduledOccurrence({
    occurrences: todaySessions,
    referenceInstant: now,
  })
  const nextSeries = nextOccurrence
    ? series.find((item) => item.id === nextOccurrence.seriesId)
    : null
  const sessionPosition = nextOccurrence?.id === todaySessions[0]?.id ? "first" : "next"
  const dateLabel = formatAcademyDate(now, {
    day: "numeric",
    month: "long",
    weekday: "long",
    year: undefined,
  })
  const financePeriod = getAcademyMonthKey(now)
  const financeActive = Boolean(getFinanceActivation())
  const finance = financeActive
    ? getCoachFinanceDashboardSummary(financePeriod, {
        coachId: identity.subjectId,
        now,
      })
    : {
        attentionCount: 0,
        outstandingPaise: 0,
        preparation: { alreadyPrepared: 0, ready: 0 },
      }
  const activeAnnouncementCount = listCoachAnnouncements(
    { status: "active" },
    { coachId: identity.subjectId, now },
  ).length
  const playerRecords = listOperationalPlayerRecords()
  const activePlayerIds = playerRecords.trainingProfiles
    .filter((profile) => profile.status === "active")
    .map((profile) => profile.memberId)
  const reportMonth = getLatestCompletedReportMonth()
  const reports = listCoachMonthlyReports()
  const completedReportCount = activePlayerIds.filter((playerId) => (
    getCoachReportState(reports.find((report) => (
      report.playerId === playerId && report.month === reportMonth
    ))) === "published"
  )).length
  const pendingRegistrationCount = listPendingRegistrations().length

  return (
    <>
      <CoachWelcomeHero
        coachName={identity.firstName}
        dateLabel={dateLabel}
        dateTime={today}
        greeting={currentGreeting()}
        upcomingSession={nextOccurrence && nextSeries ? {
          time: formatAcademyTime(nextOccurrence.startsAt),
          title: formatSessionLabel({
            programme: nextSeries.programme,
            batch: nextSeries.batch,
            startTime: academyTimeInputValue(nextOccurrence.startsAt),
            durationMinutes: nextOccurrence.durationMinutes,
          }),
          venue: nextOccurrence.venue,
        } : null}
        sessionCount={todaySessions.length}
        sessionPosition={sessionPosition}
      />
      <CoachDashboardStack id="attendance">
        <AttendanceCard scheduleCount={series.length} />
        <SessionsCard
          nextSessionLabel={nextSessionLabel}
          todaySessionCount={todaySessions.length}
        />
        <ReportsCard
          activePlayerIds={activePlayerIds}
          completedCount={completedReportCount}
          month={reportMonth}
        />
        <FinancialsCard
          active={financeActive}
          attentionCount={finance.attentionCount}
          outstandingPaise={finance.outstandingPaise}
          period={financePeriod}
          preparation={finance.preparation}
        />
        <AnnouncementCard activeCount={activeAnnouncementCount} />
        <MembersCard
          memberCount={playerRecords.members.length}
          pendingRegistrationCount={pendingRegistrationCount}
        />
      </CoachDashboardStack>
    </>
  )
}

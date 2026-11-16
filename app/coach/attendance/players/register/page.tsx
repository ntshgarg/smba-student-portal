import { AttendanceShell } from "@/components/coach/attendance/attendance-shell"
import { PlayerAttendanceRegister } from "@/components/coach/player-attendance-register"
import { CoachPortalProvider } from "@/components/coach/coach-portal-provider"
import {
  buildAttendanceRegisterYearOptions,
  resolveAttendanceRegisterMonth,
  resolveAttendanceRegisterSelection,
  type AttendanceRegisterQuery,
} from "@/lib/attendance/register-workspace"
import { requireHeadAdminPage } from "@/lib/auth/current-coach"
import { academyNow } from "@/lib/clock"
import { getIndiaDateKey } from "@/lib/coach/attendance-rules"
import { getCoachAttendanceRegisterSnapshot } from "@/lib/coach/session-read-models"
import { listSessionOccurrences, listSessionSeries } from "@/lib/sessions/database"

export const metadata = {
  title: "Player attendance register",
}

export default async function PlayerAttendanceRegisterPage({
  searchParams,
}: {
  searchParams: Promise<AttendanceRegisterQuery>
}) {
  await requireHeadAdminPage()
  const query = await searchParams
  const now = academyNow()
  const today = getIndiaDateKey(now)
  const sessionSeries = listSessionSeries()
  const yearOptions = buildAttendanceRegisterYearOptions({
    persistedDateKeys: sessionSeries.flatMap((series) => (
      series.endsOn ? [series.startsOn, series.endsOn] : [series.startsOn]
    )),
    today,
  })
  const selection = resolveAttendanceRegisterSelection({
    occurrences: listSessionOccurrences(today, today),
    query,
    series: sessionSeries,
    supportedYears: yearOptions,
    today,
  })
  const snapshot = getCoachAttendanceRegisterSnapshot(selection, sessionSeries)
  const month = resolveAttendanceRegisterMonth({
    activeDateKeys: snapshot.sessionOccurrences
      .filter((occurrence) => occurrence.status === "scheduled")
      .map((occurrence) => occurrence.occurrenceDate),
    query,
    today,
    year: selection.year,
  })
  const providerKey = `${selection.year}:${selection.programme}:${selection.batch}`

  return (
    <AttendanceShell activeTab="register">
      <CoachPortalProvider
        key={providerKey}
        initialAcademyHolidays={snapshot.academyHolidays}
        initialAttendanceAdjustments={snapshot.attendanceAdjustments}
        initialAttendanceRecords={snapshot.attendanceRecords}
        initialMembers={snapshot.members}
        initialSessionAssignments={snapshot.sessionAssignments}
        initialSessionOccurrences={snapshot.sessionOccurrences}
        initialSessionSeries={snapshot.sessionSeries}
        initialTrainingProfiles={snapshot.trainingProfiles}
      >
        <PlayerAttendanceRegister
          month={month}
          referenceDate={today}
          referenceInstant={now.getTime()}
          selection={selection}
          yearOptions={yearOptions}
        />
      </CoachPortalProvider>
    </AttendanceShell>
  )
}

import { PlayerAttendanceRegister } from "@/components/coach/player-attendance-register"
import { CoachPortalProvider } from "@/components/coach/coach-portal-provider"
import {
  resolveAttendanceRegisterSelection,
  type AttendanceRegisterQuery,
} from "@/lib/attendance/register-workspace"
import { requireHeadAdminPage } from "@/lib/auth/current-coach"
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
  const today = getIndiaDateKey()
  const sessionSeries = listSessionSeries()
  const selection = resolveAttendanceRegisterSelection({
    occurrences: listSessionOccurrences(today, today),
    query,
    series: sessionSeries,
    today,
  })
  const snapshot = getCoachAttendanceRegisterSnapshot(selection, sessionSeries)
  const providerKey = `${selection.year}:${selection.programme}:${selection.batch}`

  return (
    <CoachPortalProvider
      key={providerKey}
      initialAttendanceAdjustments={snapshot.attendanceAdjustments}
      initialAttendanceRecords={snapshot.attendanceRecords}
      initialMembers={snapshot.members}
      initialPendingRegistrations={[]}
      initialReports={[]}
      initialSessionAssignments={snapshot.sessionAssignments}
      initialSessionOccurrences={snapshot.sessionOccurrences}
      initialSessionSeries={snapshot.sessionSeries}
      initialTrainingProfiles={snapshot.trainingProfiles}
    >
      <PlayerAttendanceRegister selection={selection} />
    </CoachPortalProvider>
  )
}

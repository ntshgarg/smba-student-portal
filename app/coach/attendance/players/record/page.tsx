import { redirect } from "next/navigation"

import { PlayerAttendanceRecorder } from "@/components/coach/attendance/player-attendance-recorder"
import { CoachPortalProvider } from "@/components/coach/coach-portal-provider"
import { listAttendanceAdjustments } from "@/lib/attendance/adjustments"
import {
  playerAttendanceRecordHref,
  resolvePlayerAttendanceSelection,
  type PlayerAttendanceQuery,
} from "@/lib/attendance/recording-workspace"
import { requireHeadAdminPage } from "@/lib/auth/current-coach"
import { getIndiaDateKey } from "@/lib/coach/attendance-rules"
import { getCoachSessionSnapshot, listOperationalPlayerRecords } from "@/lib/coach/database"
import { listSessionAttendanceRecords } from "@/lib/sessions/database"

export const metadata = {
  title: "Record player attendance",
}

export default async function RecordPlayerAttendancePage({
  searchParams,
}: {
  searchParams: Promise<PlayerAttendanceQuery>
}) {
  await requireHeadAdminPage()
  const query = await searchParams
  const today = getIndiaDateKey()
  const requestedDate = Array.isArray(query.date) ? query.date[0] : query.date
  const referenceDate = requestedDate && /^\d{4}-\d{2}-\d{2}$/u.test(requestedDate)
    ? requestedDate
    : today
  const sessions = getCoachSessionSnapshot(referenceDate)
  const selection = resolvePlayerAttendanceSelection({
    occurrences: sessions.sessionOccurrences,
    query,
    today,
  })

  if (selection.requiresCanonicalRedirect) {
    redirect(playerAttendanceRecordHref(selection))
  }

  const players = listOperationalPlayerRecords()

  return (
    <CoachPortalProvider
      initialAttendanceAdjustments={listAttendanceAdjustments({ includeVoided: true })}
      initialAttendanceRecords={listSessionAttendanceRecords()}
      initialMembers={players.members}
      initialPendingRegistrations={[]}
      initialReports={[]}
      initialSessionAssignments={sessions.sessionAssignments}
      initialSessionOccurrences={sessions.sessionOccurrences}
      initialSessionSeries={sessions.sessionSeries}
      initialTrainingProfiles={players.trainingProfiles}
    >
      <PlayerAttendanceRecorder
        key={`${selection.dateKey}:${selection.occurrenceId ?? "none"}:${selection.fromCalendar ? "calendar" : "dashboard"}`}
        initialDate={selection.dateKey}
        initialFromCalendar={selection.fromCalendar}
        initialOccurrenceId={selection.occurrenceId}
      />
    </CoachPortalProvider>
  )
}

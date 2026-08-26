import { redirect } from "next/navigation"

import { PlayerAttendanceRecorder } from "@/components/coach/attendance/player-attendance-recorder"
import { CoachPortalProvider } from "@/components/coach/coach-portal-provider"
import {
  playerAttendanceRecordHref,
  resolvePlayerAttendanceSelection,
  type PlayerAttendanceQuery,
} from "@/lib/attendance/recording-workspace"
import { requireHeadAdminPage } from "@/lib/auth/current-coach"
import { academyNow } from "@/lib/clock"
import { getIndiaDateKey } from "@/lib/coach/attendance-rules"
import { getCoachAttendanceRecorderSnapshot } from "@/lib/coach/session-read-models"

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
  const now = academyNow()
  const today = getIndiaDateKey(now)
  const requestedDate = Array.isArray(query.date) ? query.date[0] : query.date
  const referenceDate = requestedDate && /^\d{4}-\d{2}-\d{2}$/u.test(requestedDate)
    ? requestedDate
    : today
  const snapshot = getCoachAttendanceRecorderSnapshot(referenceDate)
  const selection = resolvePlayerAttendanceSelection({
    occurrences: snapshot.sessionOccurrences,
    query,
    today,
  })

  if (selection.requiresCanonicalRedirect) {
    redirect(playerAttendanceRecordHref(selection))
  }

  return (
    <CoachPortalProvider
      initialAttendanceAdjustments={snapshot.attendanceAdjustments}
      initialAttendanceRecords={snapshot.attendanceRecords}
      initialMembers={snapshot.members}
      initialReports={[]}
      initialSessionAssignments={snapshot.sessionAssignments}
      initialSessionOccurrences={snapshot.sessionOccurrences}
      initialSessionSeries={snapshot.sessionSeries}
      initialTrainingProfiles={snapshot.trainingProfiles}
    >
      <PlayerAttendanceRecorder
        key={`${selection.dateKey}:${selection.occurrenceId ?? "none"}:${selection.fromCalendar ? "calendar" : "dashboard"}`}
        initialDate={selection.dateKey}
        initialFromCalendar={selection.fromCalendar}
        initialOccurrenceId={selection.occurrenceId}
        initialReferenceInstant={now.getTime()}
      />
    </CoachPortalProvider>
  )
}

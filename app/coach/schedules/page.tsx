import { SessionSchedules } from "@/components/coach/calendar/session-schedules"
import { CoachPortalProvider } from "@/components/coach/coach-portal-provider"
import { requireHeadAdminPage } from "@/lib/auth/current-coach"
import { getCoachSessionSnapshot, listOperationalPlayerRecords } from "@/lib/coach/database"
import type { TrainingProgramme } from "@/lib/sessions/types"

export const metadata = { title: "Schedules & rosters" }

export default async function CoachSchedulesPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string
    player?: string
    programme?: string
    series?: string
  }>
}) {
  await requireHeadAdminPage()
  const params = await searchParams
  const programmes: TrainingProgramme[] = ["Beginner", "Intermediate", "Advanced", "Adult"]
  const players = listOperationalPlayerRecords()
  const sessions = getCoachSessionSnapshot()
  return (
    <CoachPortalProvider
      initialAttendanceAdjustments={[]}
      initialAttendanceRecords={{}}
      initialMembers={players.members}
      initialPendingRegistrations={[]}
      initialReports={[]}
      initialSessionAssignments={sessions.sessionAssignments}
      initialSessionOccurrences={sessions.sessionOccurrences}
      initialSessionSeries={sessions.sessionSeries}
      initialTrainingProfiles={players.trainingProfiles}
    >
      <SessionSchedules
        guidedFromEvaluation={params.from === "evaluation"}
        initialPlayerId={params.player ?? null}
        initialProgramme={programmes.find((programme) => programme === params.programme) ?? null}
        initialSeriesId={params.series ?? null}
      />
    </CoachPortalProvider>
  )
}

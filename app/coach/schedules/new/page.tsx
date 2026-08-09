import { SessionScheduleCreate } from "@/components/coach/calendar/session-create"
import { CoachPortalProvider } from "@/components/coach/coach-portal-provider"
import { requireHeadAdminPage } from "@/lib/auth/current-coach"
import { listOperationalPlayerRecords } from "@/lib/coach/database"
import type { TrainingBatch, TrainingProgramme } from "@/lib/sessions/types"

export const metadata = { title: "Create schedule" }

const programmes: TrainingProgramme[] = ["Beginner", "Intermediate", "Advanced", "Adult"]
const batches: TrainingBatch[] = ["Weekday", "Weekend"]

export default async function CoachCreateSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{
    batch?: string
    from?: string
    player?: string
    programme?: string
  }>
}) {
  await requireHeadAdminPage()
  const params = await searchParams
  const players = listOperationalPlayerRecords()
  return (
    <CoachPortalProvider
      initialAttendanceAdjustments={[]}
      initialAttendanceRecords={{}}
      initialMembers={players.members}
      initialPendingRegistrations={[]}
      initialReports={[]}
      initialSessionAssignments={[]}
      initialSessionOccurrences={[]}
      initialSessionSeries={[]}
      initialTrainingProfiles={players.trainingProfiles}
    >
      <SessionScheduleCreate
        guidedFromEvaluation={params.from === "evaluation"}
        initialBatch={batches.find((batch) => batch === params.batch)}
        initialPlayerId={params.player ?? null}
        initialProgramme={programmes.find((programme) => programme === params.programme)}
      />
    </CoachPortalProvider>
  )
}

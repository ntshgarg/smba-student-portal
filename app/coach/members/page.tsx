import { CoachPortalProvider } from "@/components/coach/coach-portal-provider"
import { MemberDirectory } from "@/components/coach/members/member-directory"
import { requireHeadAdminPage } from "@/lib/auth/current-coach"
import {
  getCoachSessionSnapshot,
  listApprovedPlayerRecords,
  listApprovedStaffRecords,
} from "@/lib/coach/database"

export const metadata = {
  title: "Member Directory",
}

export default async function CoachMembersPage() {
  await requireHeadAdminPage()
  const players = listApprovedPlayerRecords()
  const sessions = getCoachSessionSnapshot()
  const staff = listApprovedStaffRecords()

  return (
    <CoachPortalProvider
      initialMembers={players.members}
      initialSessionAssignments={sessions.sessionAssignments}
      initialSessionSeries={sessions.sessionSeries}
      initialTrainingProfiles={players.trainingProfiles}
    >
      <MemberDirectory staff={staff} />
    </CoachPortalProvider>
  )
}

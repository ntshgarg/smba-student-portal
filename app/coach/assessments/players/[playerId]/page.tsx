import { notFound } from "next/navigation"

import { AssessmentHistory } from "@/components/assessments/assessment-history"
import { listPlayerAssessmentHistory } from "@/lib/assessments/queries"
import { requireHeadAdminPage } from "@/lib/auth/current-coach"

export const metadata = {
  title: "Assessment history",
}

export default async function PlayerAssessmentHistoryPage({
  params,
}: {
  params: Promise<{ playerId: string }>
}) {
  const [{ playerId }, { identity }] = await Promise.all([params, requireHeadAdminPage()])
  const history = listPlayerAssessmentHistory(playerId, identity.subjectId)
  if (!history) notFound()

  return (
    <AssessmentHistory
      assessments={history.assessments}
      playerId={playerId}
      playerName={history.playerName}
    />
  )
}

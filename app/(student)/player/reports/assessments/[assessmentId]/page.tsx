import { notFound, redirect } from "next/navigation"

import { PlayerAssessmentReport } from "@/components/assessments/assessment-report"
import { getPublishedAssessmentForPlayer } from "@/lib/assessments/queries"
import { getCurrentStudent } from "@/lib/student/current-student"

export const metadata = {
  title: "Coach assessment",
}

export default async function PlayerAssessmentPage({
  params,
}: {
  params: Promise<{ assessmentId: string }>
}) {
  const [{ assessmentId }, student] = await Promise.all([params, getCurrentStudent()])
  if (!student) redirect("/login")

  // Scoped to this player and to published rows in the query itself, so another
  // player's id or a draft's id is simply not found rather than refused.
  const found = getPublishedAssessmentForPlayer(student.identity.playerId, assessmentId)
  if (!found) notFound()

  return <PlayerAssessmentReport assessment={found.assessment} previous={found.previous} />
}

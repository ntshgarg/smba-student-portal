import { notFound } from "next/navigation"

import { AssessmentForm } from "@/components/assessments/assessment-form"
import { AssessmentPlayerPicker } from "@/components/assessments/assessment-home"
import {
  getAssessmentStart,
  getCoachAssessment,
  listAssessmentHome,
} from "@/lib/assessments/queries"
import { requireHeadAdminPage } from "@/lib/auth/current-coach"
import { academyNow } from "@/lib/clock"
import { getAcademyDateKey } from "@/lib/format"

export const metadata = {
  title: "New assessment",
}

export default async function NewAssessmentPage({
  searchParams,
}: {
  searchParams: Promise<{ player?: string | string[] }>
}) {
  const [query, { identity }] = await Promise.all([searchParams, requireHeadAdminPage()])
  const requested = Array.isArray(query.player) ? query.player[0] : query.player

  if (!requested) {
    return <AssessmentPlayerPicker players={listAssessmentHome(identity.subjectId).players} />
  }

  const start = getAssessmentStart(requested, identity.subjectId)
  if (!start) notFound()
  // The half-finished one is the one to continue, not a second blank form. It is
  // rendered here rather than redirected to: saving the first draft refreshes
  // this page, and a redirect at that moment would remount the form and wipe the
  // "Draft saved" message the coach has just been given. Same component, same
  // position, so the form keeps its state across the refresh.
  const draft = start.draftId ? getCoachAssessment(start.draftId, identity.subjectId) : null

  return (
    <AssessmentForm
      assessment={draft?.assessment ?? null}
      group={start.player.group}
      player={start.player}
      previous={draft?.previous ?? start.previous}
      today={getAcademyDateKey(academyNow())}
    />
  )
}

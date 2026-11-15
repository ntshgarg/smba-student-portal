"use client"

import { formatJoinedDate } from "@/components/coach/members/directory/shared"
import { shownTrainingStart } from "@/lib/coach/onboarding"
import type { PlayerMemberRecord } from "@/lib/coach/types"
import { formatTermDate } from "@/lib/sessions/term"
import { academyPlanLabel } from "@/lib/training/academy-plans"

/** The Training tab's facts: what they train in, when, and since when. */
export function MemberTrainingPanel({
  player,
  sessionTimes,
}: {
  player: PlayerMemberRecord
  sessionTimes: string[]
}) {
  const memberId = player.member.id
  const termFinishedOn = player.training.status === "finished" ? player.training.termFinishedOn : null

  return (
    <section className="coach-member-training-facts" aria-labelledby={`training-${memberId}`}>
      <h4 id={`training-${memberId}`} className="sr-only">Current programme</h4>
      <p className="coach-member-plan-line">
        {player.training.level} · {player.training.batch} · {academyPlanLabel(player.training.academyPlan)}
      </p>
      <p className="coach-member-when">{sessionTimes.length ? sessionTimes.join(" · ") : "Not on a schedule"}</p>
      <p className="coach-member-pills">
        {shownTrainingStart(player.member) ? (
          <span>Training since <strong>{formatJoinedDate(player.member.trainingStartOn)}</strong></span>
        ) : null}
        {termFinishedOn ? <span>{`Term finished on ${formatTermDate(termFinishedOn)}`}</span> : null}
      </p>
    </section>
  )
}

"use client"

import type { PlayerMemberRecord } from "@/lib/coach/types"
import { academyPlanLabel } from "@/lib/training/academy-plans"

export function MemberTrainingPanel({
  activeSessionLabels,
  player,
}: {
  activeSessionLabels: string[]
  player: PlayerMemberRecord
}) {
  const memberId = player.member.id

  return (
    <section aria-labelledby={`training-${memberId}`}>
      <span>Training</span>
      <h4 id={`training-${memberId}`}>Current programme</h4>
      <dl>
        <div><dt>Level</dt><dd>{player.training.level}</dd></div>
        <div><dt>Batch</dt><dd>{player.training.batch}</dd></div>
        <div><dt>Academy Plan</dt><dd>{academyPlanLabel(player.training.academyPlan)}</dd></div>
        <div><dt>Status</dt><dd>{player.training.status}</dd></div>
        <div className="is-wide">
          <dt>Active sessions</dt>
          <dd>{activeSessionLabels.length
            ? activeSessionLabels.join(" · ")
            : "Not assigned"}</dd>
        </div>
      </dl>
    </section>
  )
}

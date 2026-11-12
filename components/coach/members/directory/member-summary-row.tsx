"use client"

import { ChevronDown } from "lucide-react"

import { useMemberTraining } from "@/components/coach/members/directory/member-training-context"
import { formatJoinedDate } from "@/components/coach/members/directory/shared"
import { shownTrainingStart } from "@/lib/coach/onboarding"
import type { PlayerMemberRecord } from "@/lib/coach/types"
import { trainingStatusLabel } from "@/lib/sessions/term"
import { academyPlanLabel } from "@/lib/training/academy-plans"

export function MemberSummaryRow({
  activeSessionLabels,
  index,
  isExpanded,
  onOpen,
  player,
}: {
  activeSessionLabels: string[]
  index: number
  isExpanded: boolean
  onOpen: (memberId: string) => void
  player: PlayerMemberRecord
}) {
  const memberTraining = useMemberTraining()
  const memberId = player.member.id
  // A term-finished player whose move or end is already booked stays "Term
  // finished" until it happens, so the row says it is in hand.
  const changeScheduled = player.training.status === "finished"
    && Boolean(memberTraining?.summaries[memberId]?.scheduled)

  return (
    <tr className={isExpanded ? "is-expanded" : undefined}>
      <td className="coach-member-folio" aria-hidden="true">
        {String(index + 1).padStart(2, "0")}
      </td>
      <th scope="row" data-label="Member">
        <span className="coach-member-name">
          <strong>{player.member.fullName}</strong>
          <small>{player.member.academyId}</small>
        </span>
      </th>
      <td className="coach-member-training" data-label="Training">
        <span>
          <strong>{player.training.level} · {player.training.batch}</strong>
          <small>{academyPlanLabel(player.training.academyPlan)}</small>
        </span>
      </td>
      <td className="coach-member-sessions" data-label="Sessions">
        <span>{activeSessionLabels.length
          ? `${activeSessionLabels.length} ${player.training.status === "finished" ? "finished" : "active"}${changeScheduled ? " · change scheduled" : ""}`
          : "Not assigned"}</span>
      </td>
      <td className="coach-member-joined" data-label="Training from">{shownTrainingStart(player.member) ? formatJoinedDate(player.member.trainingStartOn) : "Not set yet"}</td>
      <td className="coach-member-status-cell" data-label="Status">
        <span className={`coach-member-status is-${player.training.status}`}>
          {trainingStatusLabel(player.training.status)}
        </span>
      </td>
      <td className="coach-member-row-action">
        <button
          type="button"
          aria-expanded={isExpanded}
          aria-controls={isExpanded ? `member-details-${memberId}` : undefined}
          onClick={() => onOpen(memberId)}
        >
          <span>{isExpanded ? "Close" : "Details"}</span>
          <ChevronDown aria-hidden="true" />
        </button>
      </td>
    </tr>
  )
}

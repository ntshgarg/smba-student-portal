"use client"

import { ChevronDown } from "lucide-react"

import { formatJoinedDate } from "@/components/coach/members/directory/shared"
import type { PlayerMemberRecord } from "@/lib/coach/types"
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
  const memberId = player.member.id

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
          ? `${activeSessionLabels.length} active`
          : "Not assigned"}</span>
      </td>
      <td className="coach-member-joined" data-label="Training from">{formatJoinedDate(player.member.trainingStartOn)}</td>
      <td className="coach-member-status-cell" data-label="Status">
        <span className={`coach-member-status is-${player.training.status}`}>
          {player.training.status}
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

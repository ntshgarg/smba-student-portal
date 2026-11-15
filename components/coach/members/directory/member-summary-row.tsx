"use client"

import { ChevronDown, Clock, Layers, X } from "lucide-react"

import { useMemberTraining } from "@/components/coach/members/directory/member-training-context"
import { initials, nameParts } from "@/components/coach/members/directory/shared"
import type { PlayerMemberRecord } from "@/lib/coach/types"
import { trainingStatusLabel } from "@/lib/sessions/term"

/**
 * A player's card in the directory, and the one control that opens and closes
 * their record. Open, the same button becomes the top of the record's navy
 * band: the name large, the ID and status under it, and a close mark.
 */
export function MemberSummaryRow({
  isExpanded,
  onOpen,
  player,
  sessionTimes,
}: {
  isExpanded: boolean
  onOpen: (memberId: string) => void
  player: PlayerMemberRecord
  sessionTimes: string[]
}) {
  const memberTraining = useMemberTraining()
  const memberId = player.member.id
  // A term-finished player whose move or end is already booked stays "Term
  // finished" until it happens, so the row says it is in hand.
  const changeScheduled = player.training.status === "finished"
    && Boolean(memberTraining?.summaries[memberId]?.scheduled)
  const name = nameParts(player.member.fullName)
  const [firstTime, ...otherTimes] = sessionTimes
  const status = trainingStatusLabel(player.training.status)

  return (
    <button
      className="coach-member-card-head"
      type="button"
      aria-expanded={isExpanded}
      aria-controls={isExpanded ? `member-details-${memberId}` : undefined}
      onClick={() => onOpen(memberId)}
    >
      <span className="coach-member-badge" aria-hidden="true">{initials(player.member.fullName)}</span>
      <span className="coach-member-name">
        <strong>{name.first}{name.rest ? <> <em>{name.rest}</em></> : null}</strong>
      </span>
      <span className="coach-member-box">
        <span className="coach-member-fact">
          <Layers aria-hidden="true" />
          {player.training.level} · {player.training.batch}
        </span>
        <span className={`coach-member-fact${firstTime ? "" : " is-none"}`}>
          <Clock aria-hidden="true" />
          {firstTime ?? "No session"}
          {otherTimes.length ? ` +${otherTimes.length} more` : ""}
          {changeScheduled ? " · change scheduled" : ""}
        </span>
        <span className="coach-member-id">{player.member.academyId}</span>
      </span>
      <span className={`coach-member-status is-${player.training.status}`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
      <span className="coach-member-open-id">{player.member.academyId}</span>
      <span className="coach-member-toggle-mark" aria-hidden="true">
        {isExpanded ? <X /> : <ChevronDown />}
      </span>
      <span className="sr-only">{isExpanded ? "Close record" : "Open record"}</span>
    </button>
  )
}

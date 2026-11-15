"use client"

import { Archive } from "lucide-react"
import Link from "next/link"

import { monthBefore } from "@/components/coach/members/directory/member-training-actions"
import { useMemberTraining } from "@/components/coach/members/directory/member-training-context"
import type { PlayerMemberRecord } from "@/lib/coach/types"
import { formatTermDate } from "@/lib/sessions/term"

/** What stands between this member and Archive, in the words of the action the record offers. */
export function archiveBlockedNote(
  hasActiveAssignments: boolean,
  scheduled: { effectiveOn: string; kind: "change" | "end" } | null,
) {
  // A booked end blocks Archive until it happens, with or without a place
  // still open (the server refuses it too, lib/coach/member-service.ts).
  if (scheduled?.kind === "end") {
    const opens = `Training ends after ${monthBefore(scheduled.effectiveOn)}. Archiving opens from ${formatTermDate(scheduled.effectiveOn)}, once fees have stopped and none are owed.`
    // With no place left, End training is not offered; only cancelling the booking is.
    return hasActiveAssignments
      ? `${opens} If they have left already, use End training again and tick “They have left already”.`
      : `${opens} To archive sooner, use Cancel scheduled change on the Training tab; their fee plan then keeps running until you stop it.`
  }
  if (!hasActiveAssignments) return null
  return "Use End training on the Training tab before archiving this member."
}

export function MemberAccessActions({
  hasActiveAssignments,
  isArchiving,
  onArchive,
  player,
  recoveryHref,
  retryAction,
}: {
  hasActiveAssignments: boolean
  isArchiving: boolean
  onArchive: (player: PlayerMemberRecord) => Promise<void>
  player: PlayerMemberRecord
  recoveryHref: string | undefined
  retryAction: "archive" | "save" | undefined
}) {
  const summary = useMemberTraining()?.summaries[player.member.id] ?? null
  const blocked = archiveBlockedNote(hasActiveAssignments, summary?.scheduled ?? null)

  return (
    <div className="coach-member-access-actions">
      <div>
        <span>Member access</span>
        <p>{blocked ?? "Archiving revokes portal access and preserves academy history."}</p>
      </div>
      {blocked ? null : (
        <>
          {recoveryHref ? (
            <Link href={recoveryHref}>
              Open Fee Record
            </Link>
          ) : null}
          <button
            type="button"
            disabled={isArchiving}
            onClick={() => void onArchive(player)}
          >
            <Archive aria-hidden="true" /> {isArchiving
              ? "Archiving…"
              : retryAction === "archive"
                ? "Archive member again"
                : "Archive member"}
          </button>
        </>
      )}
    </div>
  )
}

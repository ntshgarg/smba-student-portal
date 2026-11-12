"use client"

import { Archive } from "lucide-react"
import Link from "next/link"

import { useMemberTraining } from "@/components/coach/members/directory/member-training-context"
import type { PlayerMemberRecord } from "@/lib/coach/types"
import { formatDateKey } from "@/lib/format"

function longDate(dateKey: string) {
  return formatDateKey(dateKey, { day: "numeric", month: "long", weekday: undefined, year: "numeric" })
}

/*
 * What stands between this member and Archive, in the words of the action the
 * record offers. It used to say "Use End training above" to a coach who had
 * just booked it, with no hint that archiving opens once that end happens on
 * the 1st, or straight away with "They have left already".
 */
export function archiveBlockedNote(
  hasActiveAssignments: boolean,
  scheduled: { effectiveOn: string; kind: "change" | "end" } | null,
) {
  if (hasActiveAssignments && scheduled?.kind === "end") {
    return `Training ends on ${longDate(scheduled.effectiveOn)}, and archiving opens then. If they have left already, use End training again and tick “They have left already”.`
  }
  if (hasActiveAssignments) return "Use End training above before archiving this member."
  if (scheduled?.kind === "change") {
    return `Training is booked to start on ${longDate(scheduled.effectiveOn)}. Cancel that booked change above before archiving this member.`
  }
  return null
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
  const scheduled = useMemberTraining()?.summaries[player.member.id]?.scheduled ?? null
  const blocked = archiveBlockedNote(hasActiveAssignments, scheduled)

  return (
    <div className="coach-member-access-actions">
      <div>
        <span>Member access</span>
        <p>{blocked ?? "Archiving revokes portal access and preserves academy history."}</p>
      </div>
      {/* After a fees refusal the Fee Record is offered beside Archive, not
          instead of it, so the coach can try again once fees are settled
          without closing and reopening the record. */}
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

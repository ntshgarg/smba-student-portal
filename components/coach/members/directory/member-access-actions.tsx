"use client"

import { Archive } from "lucide-react"
import Link from "next/link"

import { useMemberTraining } from "@/components/coach/members/directory/member-training-context"
import type { PlayerMemberRecord } from "@/lib/coach/types"
import { formatDateKey } from "@/lib/format"

function longDate(dateKey: string) {
  return formatDateKey(dateKey, { day: "numeric", month: "long", weekday: undefined, year: "numeric" })
}

/** The month before a change dated the 1st, as the training panel names it. */
function monthBefore(firstOfMonth: string) {
  const [year, month] = firstOfMonth.split("-").map(Number)
  return formatDateKey(new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10), {
    day: undefined, month: "long", weekday: undefined, year: "numeric",
  })
}

/*
 * What stands between this member and Archive, in the words of the action the
 * record offers. It used to say "Use End training above" to a coach who had
 * just booked it, with no hint that archiving opens once that end happens on
 * the 1st, or straight away with "They have left already".
 *
 * Archive also waits for the fee plan to stop and for nothing to be owed
 * (archiveMemberRecord). So archiving is promised from the 1st only when the
 * booked end stops fees, or there is no fee plan; an end that keeps the plan
 * (a break) names Stop fees, which is offered once they are off the schedule.
 */
export function archiveBlockedNote(
  hasActiveAssignments: boolean,
  scheduled: { effectiveOn: string; kind: "change" | "end"; stopFees?: boolean } | null,
  hasFeePlan = false,
) {
  if (hasActiveAssignments && scheduled?.kind === "end") {
    const ends = `Training ends after ${monthBefore(scheduled.effectiveOn)}`
    const from = longDate(scheduled.effectiveOn)
    if (scheduled.stopFees || !hasFeePlan) {
      return `${ends}. Archiving opens from ${from}, once no fees are owed. If they have left already, use End training again and tick “They have left already”.`
    }
    return `${ends}, and their fee plan is kept. To archive them, use Stop fees from ${from}, once no fees are owed. If they have left already, use End training again, tick “They have left already” and choose Stop fees.`
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
  const summary = useMemberTraining()?.summaries[player.member.id] ?? null
  const blocked = archiveBlockedNote(
    hasActiveAssignments,
    summary?.scheduled ?? null,
    Boolean(summary?.fee?.activeAgreementId),
  )

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

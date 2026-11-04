"use client"

import { Archive } from "lucide-react"
import Link from "next/link"

import type { PlayerMemberRecord } from "@/lib/coach/types"

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

  return (
    <div className="coach-member-access-actions">
      <div>
        <span>Member access</span>
        <p>{hasActiveAssignments
          ? "Use End training above before archiving this member."
          : "Archiving revokes portal access and preserves academy history."}</p>
      </div>
      {hasActiveAssignments ? null : recoveryHref ? (
        <Link href={recoveryHref}>
          Open Fee Record
        </Link>
      ) : (
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
      )}
    </div>
  )
}

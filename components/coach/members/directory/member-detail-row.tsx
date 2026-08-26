"use client"

import { PencilLine } from "lucide-react"

import { MemberAccessActions } from "@/components/coach/members/directory/member-access-actions"
import type { MemberDraft } from "@/components/coach/members/directory/member-draft"
import { MemberEditForm } from "@/components/coach/members/directory/member-edit-form"
import { MemberProfilePanel } from "@/components/coach/members/directory/member-profile-panel"
import { MemberTrainingPanel } from "@/components/coach/members/directory/member-training-panel"
import type {
  MemberEditor,
  MemberFeedback,
} from "@/components/coach/members/directory/shared"
import { InlineNotice } from "@/components/inline-notice"
import type { PlayerMemberRecord } from "@/lib/coach/types"

export function MemberDetailRow({
  activeSessionLabels,
  contactRevealed,
  draft,
  editor,
  feedback,
  isArchiving,
  isEditing,
  onArchive,
  onBeginEdit,
  onRevealContact,
  player,
  setContactLinkRef,
  setEditButtonRef,
}: {
  activeSessionLabels: string[]
  contactRevealed: boolean
  draft: MemberDraft | null
  editor: MemberEditor
  feedback: MemberFeedback | null
  isArchiving: boolean
  isEditing: boolean
  onArchive: (player: PlayerMemberRecord) => Promise<void>
  onBeginEdit: (player: PlayerMemberRecord) => void
  onRevealContact: (memberId: string) => void
  player: PlayerMemberRecord
  setContactLinkRef: (memberId: string, node: HTMLAnchorElement | null) => void
  setEditButtonRef: (memberId: string, node: HTMLButtonElement | null) => void
}) {
  const memberId = player.member.id
  const hasActiveAssignments = activeSessionLabels.length > 0
  const retryAction = feedback?.offerRetry
    ? feedback.retryAction
    : undefined

  return (
    <tr className="coach-member-detail-row">
      <td colSpan={7}>
        <div id={`member-details-${memberId}`} className="coach-member-detail-panel">
          <div className="coach-member-detail-heading">
            <div>
              <span>Member record</span>
              <h3 id={`member-details-title-${memberId}`} tabIndex={-1}>{player.member.fullName}</h3>
              <p>{player.member.academyId} · {player.training.level}</p>
            </div>
            {!isEditing ? (
              <button
                ref={(node) => setEditButtonRef(memberId, node)}
                type="button"
                onClick={() => onBeginEdit(player)}
              >
                <PencilLine aria-hidden="true" /> Edit member
              </button>
            ) : null}
          </div>

          {isEditing && draft ? (
            <MemberEditForm
              draft={draft}
              editor={editor}
              feedback={feedback}
              hasActiveAssignments={hasActiveAssignments}
              player={player}
              retryAction={retryAction}
            />
          ) : (
            <div className="coach-member-detail-domains">
              <MemberProfilePanel
                contactRevealed={contactRevealed}
                onRevealContact={onRevealContact}
                player={player}
                setContactLinkRef={setContactLinkRef}
              />

              <MemberTrainingPanel
                activeSessionLabels={activeSessionLabels}
                player={player}
              />
            </div>
          )}

          {!isEditing ? (
            <MemberAccessActions
              hasActiveAssignments={hasActiveAssignments}
              isArchiving={isArchiving}
              onArchive={onArchive}
              player={player}
              recoveryHref={feedback?.recoveryHref}
              retryAction={retryAction}
            />
          ) : null}

          {!isEditing ? (
            <InlineNotice
              className="coach-member-save-notice"
              message={feedback?.message ?? null}
              reserveSpace={false}
              tone={feedback?.tone ?? "info"}
            />
          ) : null}
        </div>
      </td>
    </tr>
  )
}

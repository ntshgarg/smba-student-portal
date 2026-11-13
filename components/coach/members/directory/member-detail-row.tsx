"use client"

import { PencilLine, X } from "lucide-react"

import { MemberAccessActions } from "@/components/coach/members/directory/member-access-actions"
import type { MemberDraft } from "@/components/coach/members/directory/member-draft"
import { MemberEditForm } from "@/components/coach/members/directory/member-edit-form"
import { MemberProfilePanel } from "@/components/coach/members/directory/member-profile-panel"
import { MemberTrainingActions } from "@/components/coach/members/directory/member-training-actions"
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
  onClose,
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
  onClose: (memberId: string) => void
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
      <td colSpan={6}>
        <div id={`member-details-${memberId}`} className="coach-member-detail-panel">
          <div className="coach-member-detail-heading">
            <div>
              <span>Member record</span>
              <h3 id={`member-details-title-${memberId}`} tabIndex={-1}>{player.member.fullName}</h3>
              <p>{player.member.academyId} · {player.training.level}</p>
            </div>
            <div className="coach-member-detail-heading-actions">
              {!isEditing ? (
                <button
                  ref={(node) => setEditButtonRef(memberId, node)}
                  type="button"
                  onClick={() => onBeginEdit(player)}
                >
                  <PencilLine aria-hidden="true" /> Edit member
                </button>
              ) : null}
              <button className="is-quiet" type="button" onClick={() => onClose(memberId)}>
                <X aria-hidden="true" /> Close
              </button>
            </div>
          </div>

          {!isEditing ? <MemberTrainingActions player={player} /> : null}

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
              action={feedback?.action}
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

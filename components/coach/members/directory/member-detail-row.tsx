"use client"

import { PencilLine } from "lucide-react"
import { useState, type KeyboardEvent } from "react"

import { MemberAccessActions } from "@/components/coach/members/directory/member-access-actions"
import type { MemberDraft } from "@/components/coach/members/directory/member-draft"
import { MemberEditForm } from "@/components/coach/members/directory/member-edit-form"
import { MemberProfilePanel } from "@/components/coach/members/directory/member-profile-panel"
import { MemberTrainingActions } from "@/components/coach/members/directory/member-training-actions"
import { useMemberTraining } from "@/components/coach/members/directory/member-training-context"
import { MemberTrainingPanel } from "@/components/coach/members/directory/member-training-panel"
import type {
  MemberEditor,
  MemberFeedback,
} from "@/components/coach/members/directory/shared"
import { InlineNotice } from "@/components/inline-notice"
import type { PlayerMemberRecord } from "@/lib/coach/types"

type RecordTab = "training" | "fees" | "profile"

const tabLabels: Record<RecordTab, string> = {
  fees: "Fees",
  profile: "Profile",
  training: "Training",
}

/**
 * A player's record, under the card that opened it: Training, Fees and Profile
 * as tabs. The training and fee actions stay mounted while another tab is
 * shown, so a half-filled form keeps what was entered when the coach looks
 * elsewhere and comes back.
 */
export function MemberDetailRow({
  contactRevealed,
  draft,
  editor,
  feedback,
  holdsPlace,
  isArchiving,
  isEditing,
  onArchive,
  onBeginEdit,
  onRevealContact,
  player,
  sessionTimes,
  setContactLinkRef,
  setEditButtonRef,
}: {
  contactRevealed: boolean
  draft: MemberDraft | null
  editor: MemberEditor
  feedback: MemberFeedback | null
  /** Any schedule place, open or ended. */
  holdsPlace: boolean
  isArchiving: boolean
  isEditing: boolean
  onArchive: (player: PlayerMemberRecord) => Promise<void>
  onBeginEdit: (player: PlayerMemberRecord) => void
  onRevealContact: (memberId: string) => void
  player: PlayerMemberRecord
  sessionTimes: string[]
  setContactLinkRef: (memberId: string, node: HTMLAnchorElement | null) => void
  setEditButtonRef: (memberId: string, node: HTMLButtonElement | null) => void
}) {
  const memberId = player.member.id
  const financeActive = Boolean(useMemberTraining()?.financeActive)
  const tabs: RecordTab[] = financeActive ? ["training", "fees", "profile"] : ["training", "profile"]
  const [tab, setTab] = useState<RecordTab>(isEditing ? "profile" : "training")
  const hasActiveAssignments = sessionTimes.length > 0
  const retryAction = feedback?.offerRetry
    ? feedback.retryAction
    : undefined
  const tabId = (item: RecordTab) => `member-${memberId}-tab-${item}`

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0
    const edge = event.key === "Home" ? tabs[0] : event.key === "End" ? tabs[tabs.length - 1] : null
    if (!step && !edge) return
    event.preventDefault()
    const next = edge ?? tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length]
    setTab(next)
    document.getElementById(tabId(next))?.focus()
  }

  return (
    <div id={`member-details-${memberId}`} className="coach-member-record">
      {/* The name is on the card above; this heading names the record for
          screen readers and is where a deep link lands. */}
      <h3 className="sr-only" id={`member-details-title-${memberId}`} tabIndex={-1}>{player.member.fullName}</h3>

      <div className="coach-member-tabs" role="tablist" aria-label={`${player.member.fullName}’s record`}>
        {tabs.map((item) => (
          <button
            key={item}
            id={tabId(item)}
            type="button"
            role="tab"
            aria-selected={item === tab}
            aria-controls={`member-${memberId}-panel`}
            tabIndex={item === tab ? 0 : -1}
            onClick={() => setTab(item)}
            onKeyDown={onTabKey}
          >
            {tabLabels[item]}
          </button>
        ))}
      </div>

      <div
        id={`member-${memberId}-panel`}
        className="coach-member-record-body"
        role="tabpanel"
        aria-labelledby={tabId(tab)}
      >
        {tab === "training" ? <MemberTrainingPanel player={player} sessionTimes={sessionTimes} /> : null}

        {/* Not while the profile is being edited: a training or fee change bumps
            the record's revision, which would turn the edit's save into a
            conflict, so the two never run side by side. */}
        {isEditing ? (
          tab !== "profile" ? (
            <p className="coach-member-editing-note">Finish or cancel Edit details on the Profile tab first.</p>
          ) : null
        ) : (
          <div hidden={tab === "profile"}>
            <MemberTrainingActions player={player} view={tab === "fees" ? "fees" : "training"} />
          </div>
        )}

        {tab === "profile" ? (
          isEditing && draft ? (
            <MemberEditForm
              draft={draft}
              editor={editor}
              feedback={feedback}
              hasActiveAssignments={hasActiveAssignments}
              holdsPlace={holdsPlace}
              player={player}
              retryAction={retryAction}
            />
          ) : (
            <>
              <MemberProfilePanel
                contactRevealed={contactRevealed}
                onRevealContact={onRevealContact}
                player={player}
                setContactLinkRef={setContactLinkRef}
              />
              <div className="coach-member-profile-actions">
                <button
                  ref={(node) => setEditButtonRef(memberId, node)}
                  type="button"
                  onClick={() => onBeginEdit(player)}
                >
                  <PencilLine aria-hidden="true" /> Edit details
                </button>
              </div>
              <MemberAccessActions
                hasActiveAssignments={hasActiveAssignments}
                isArchiving={isArchiving}
                onArchive={onArchive}
                player={player}
                recoveryHref={feedback?.recoveryHref}
                retryAction={retryAction}
              />
            </>
          )
        ) : null}

        {!isEditing ? (
          <InlineNotice
            action={feedback?.action}
            message={feedback?.message ?? null}
            reserveSpace={false}
            tone={feedback?.tone ?? "info"}
          />
        ) : null}
      </div>
    </div>
  )
}

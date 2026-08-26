"use client"

import { Eye, Phone } from "lucide-react"

import { formatJoinedDate } from "@/components/coach/members/directory/shared"
import type { PlayerMemberRecord } from "@/lib/coach/types"

const timelineInstantFormat = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
})

function formatTimelineInstant(value: string | null | undefined) {
  if (!value) return "Not completed"
  return timelineInstantFormat.format(new Date(value))
}

export function MemberProfilePanel({
  contactRevealed,
  onRevealContact,
  player,
  setContactLinkRef,
}: {
  contactRevealed: boolean
  onRevealContact: (memberId: string) => void
  player: PlayerMemberRecord
  setContactLinkRef: (memberId: string, node: HTMLAnchorElement | null) => void
}) {
  const memberId = player.member.id

  return (
    <section aria-labelledby={`profile-${memberId}`}>
      <span>Profile</span>
      <h4 id={`profile-${memberId}`}>Member details</h4>
      <dl>
        <div>
          <dt>Registration requested</dt>
          <dd>{formatTimelineInstant(player.member.requestedAt)}</dd>
        </div>
        <div>
          <dt>Coach approved</dt>
          <dd>{formatTimelineInstant(player.member.approvedAt)}</dd>
        </div>
        <div>
          <dt>Training from</dt>
          <dd>{formatJoinedDate(player.member.trainingStartOn)}</dd>
        </div>
        <div>
          <dt>Account activated</dt>
          <dd>{formatTimelineInstant(player.member.activatedAt)}</dd>
        </div>
        <div>
          <dt>Onboarding completed</dt>
          <dd>{formatTimelineInstant(player.member.onboardingCompletedAt)}</dd>
        </div>
        <div>
          <dt>Academy ID</dt>
          <dd>{player.member.academyId}</dd>
        </div>
        <div>
          <dt>Primary contact</dt>
          <dd>
            {!player.member.primaryContact.phone ? (
              <span>Not added</span>
            ) : contactRevealed ? (
              <span
                id={`member-${memberId}-primary-contact`}
                className="coach-member-contact"
              >
                <strong>{player.member.primaryContact.name}</strong>
                <small>{player.member.primaryContact.relationship}</small>
                <a
                  ref={(node) => setContactLinkRef(memberId, node)}
                  href={`tel:${player.member.primaryContact.phone.replace(/\s/gu, "")}`}
                >
                  <Phone aria-hidden="true" /> {player.member.primaryContact.phone}
                </a>
              </span>
            ) : (
              <button
                className="coach-member-contact-reveal"
                type="button"
                aria-label={`Reveal primary contact for ${player.member.fullName}`}
                onClick={() => onRevealContact(memberId)}
              >
                <Eye aria-hidden="true" /> Tap to reveal
              </button>
            )}
          </dd>
        </div>
      </dl>
    </section>
  )
}

"use client"

import { Eye, Phone } from "lucide-react"

import { formatJoinedDate } from "@/components/coach/members/directory/shared"
import { shownTrainingStart } from "@/lib/coach/onboarding"
import type { PlayerMemberRecord } from "@/lib/coach/types"

const timelineInstantFormat = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
})

function formatTimelineInstant(value: string) {
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
  const contact = player.member.primaryContact
  // The one-time steps of joining the academy, in the order they happen.
  // None of them changes when training pauses, ends or restarts.
  const steps = [
    { label: "Registered", value: player.member.requestedAt ? formatTimelineInstant(player.member.requestedAt) : null },
    { label: "Approved", value: player.member.approvedAt ? formatTimelineInstant(player.member.approvedAt) : null },
    { label: "Account set up", value: player.member.activatedAt ? formatTimelineInstant(player.member.activatedAt) : null },
    { label: "Onboarded", value: player.member.onboardingCompletedAt ? formatTimelineInstant(player.member.onboardingCompletedAt) : null },
    { label: "Training from", value: shownTrainingStart(player.member) ? formatJoinedDate(player.member.trainingStartOn) : null },
  ]

  return (
    <section className="coach-member-profile" aria-labelledby={`profile-${memberId}`}>
      <h4 id={`profile-${memberId}`} className="sr-only">Member details</h4>
      <div className="coach-member-contact-box">
        <div>
          <span>Primary contact</span>
          {!contact.phone ? (
            <p>Not added</p>
          ) : contactRevealed ? (
            <p id={`member-${memberId}-primary-contact`} className="coach-member-contact">
              <strong>{contact.name}</strong>
              <small>{contact.relationship}</small>
              <a
                ref={(node) => setContactLinkRef(memberId, node)}
                href={`tel:${contact.phone.replace(/\s/gu, "")}`}
              >
                <Phone aria-hidden="true" /> {contact.phone}
              </a>
            </p>
          ) : (
            <p>Phone and relationship</p>
          )}
        </div>
        {contact.phone && !contactRevealed ? (
          <button
            className="coach-member-contact-reveal"
            type="button"
            aria-label={`Reveal primary contact for ${player.member.fullName}`}
            onClick={() => onRevealContact(memberId)}
          >
            <Eye aria-hidden="true" /> Show contact
          </button>
        ) : null}
      </div>

      <div className="coach-member-joining">
        <span>Joining</span>
        <ol>
          {steps.map((step) => (
            <li key={step.label} className={step.value ? undefined : "is-pending"}>
                <span className="coach-member-joining-mark" aria-hidden="true" />
              <strong>{step.label}</strong>
              <small>{step.value ?? (step.label === "Training from" ? "Not set yet" : "Not yet")}</small>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

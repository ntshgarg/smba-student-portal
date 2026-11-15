"use client"

import { Archive, CalendarDays, ChevronDown, UserRound, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { archiveCoachAction } from "@/app/coach/actions"
import { formatJoinedDate, initials, nameParts } from "@/components/coach/members/directory/shared"
import { InlineNotice, type InlineNoticeAction } from "@/components/inline-notice"
import { describeSaveFailure } from "@/lib/client/network-failure"
import type { AcademyStaffMember } from "@/lib/coach/types"
import { getAcademyDateKey } from "@/lib/format"

export function staffAccessLabel(accessLevel: AcademyStaffMember["accessLevel"]) {
  return accessLevel === "head_admin" ? "Head coach" : "Assistant coach"
}

/** A coach's card in the directory: the same card a player has, with their role in place of training. */
export function StaffSummaryRow({
  isExpanded,
  onOpen,
  staff,
}: {
  isExpanded: boolean
  onOpen: (memberId: string) => void
  staff: AcademyStaffMember
}) {
  const activated = Boolean(staff.activatedAt)
  const name = nameParts(staff.fullName)

  return (
    <button
      className="coach-member-card-head"
      type="button"
      aria-expanded={isExpanded}
      aria-controls={isExpanded ? `member-details-${staff.id}` : undefined}
      onClick={() => onOpen(staff.id)}
    >
      <span className="coach-member-badge" aria-hidden="true">{initials(staff.fullName)}</span>
      <span className="coach-member-name">
        <strong>{name.first}{name.rest ? <> <em>{name.rest}</em></> : null}</strong>
      </span>
      <span className="coach-member-box">
        <span className="coach-member-fact">
          <UserRound aria-hidden="true" />
          {staffAccessLabel(staff.accessLevel)}
        </span>
        <span className="coach-member-fact">
          <CalendarDays aria-hidden="true" />
          Joined {formatJoinedDate(staff.joinedOn)}
        </span>
        <span className="coach-member-id">{staff.academyId}</span>
      </span>
      <span className={`coach-member-status is-${activated ? "active" : "unassigned"}`}>
        {activated ? "Active" : "Not activated"}
      </span>
      <span className="coach-member-open-id">{staff.academyId}</span>
      <span className="coach-member-toggle-mark" aria-hidden="true">
        {isExpanded ? <X /> : <ChevronDown />}
      </span>
      <span className="sr-only">{isExpanded ? "Close record" : "Open record"}</span>
    </button>
  )
}

/*
 * Archiving an assistant coach who has left. Their sign-in stops at once; their
 * past attendance stays on the staff register. The head coach's own account is
 * not offered: it is set up and replaced by the platform owner.
 */
function StaffAccessActions({
  onArchived,
  staff,
}: {
  onArchived: (staff: AcademyStaffMember) => void
  staff: AcademyStaffMember
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [signIn, setSignIn] = useState<InlineNoticeAction | undefined>(undefined)

  async function archive() {
    if (pending) return
    const confirmed = window.confirm(
      `Archive ${staff.fullName}? They will no longer be able to sign in. Their past attendance stays on the staff register.`,
    )
    if (!confirmed) return
    setPending(true)
    setMessage(null)
    setSignIn(undefined)
    try {
      const result = await archiveCoachAction({ coachAccountId: staff.id })
      if (!result.ok) {
        setMessage(result.message)
        return
      }
      onArchived(staff)
      router.refresh()
    } catch (error) {
      const failure = describeSaveFailure({
        error,
        retained: "The coach can still sign in",
        unconfirmed: "Check the connection, then reload the page to see whether the coach was archived",
        subject: "The coach archive",
      })
      setMessage(failure.message)
      setSignIn(failure.signIn)
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <div className="coach-member-access-actions">
        <div>
          <span>Coach access</span>
          <p>Archiving switches off their sign-in. Their past attendance stays on the staff register.</p>
        </div>
        <button type="button" disabled={pending} onClick={() => void archive()}>
          <Archive aria-hidden="true" /> {pending ? "Archiving…" : "Archive coach"}
        </button>
      </div>
      <InlineNotice
        action={signIn}
        message={message}
        reserveSpace={false}
        tone="error"
      />
    </>
  )
}

export function StaffDetailRow({
  onArchived,
  staff,
}: {
  onArchived: (staff: AcademyStaffMember) => void
  staff: AcademyStaffMember
}) {
  // Coaches have no training or fees here, so their record has no tabs.
  const steps = [
    { label: "Approved", value: staff.approvedAt ? formatJoinedDate(getAcademyDateKey(staff.approvedAt)) : null },
    { label: "Account set up", value: staff.activatedAt ? formatJoinedDate(getAcademyDateKey(staff.activatedAt)) : null },
  ]

  return (
    <div id={`member-details-${staff.id}`} className="coach-member-record">
      <div className="coach-member-record-body">
        <h3 className="sr-only">{staff.fullName}</h3>
        <section className="coach-member-training-facts" aria-label="Staff details">
          <p className="coach-member-plan-line">{staffAccessLabel(staff.accessLevel)}</p>
          <p className="coach-member-when">Coaching staff · joined {formatJoinedDate(staff.joinedOn)}</p>
        </section>
        <div className="coach-member-joining">
          <span>Joining</span>
          <ol>
            {steps.map((step) => (
              <li key={step.label} className={step.value ? undefined : "is-pending"}>
                <span className="coach-member-joining-mark" aria-hidden="true" />
                <strong>{step.label}</strong>
                <small>{step.value ?? "Not yet"}</small>
              </li>
            ))}
          </ol>
        </div>
        {staff.accessLevel === "junior_coach"
          ? <StaffAccessActions onArchived={onArchived} staff={staff} />
          : null}
      </div>
    </div>
  )
}

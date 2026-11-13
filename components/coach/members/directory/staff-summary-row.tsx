"use client"

import { Archive, ChevronDown } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { archiveCoachAction } from "@/app/coach/actions"
import { formatJoinedDate } from "@/components/coach/members/directory/shared"
import { InlineNotice, type InlineNoticeAction } from "@/components/inline-notice"
import { describeSaveFailure } from "@/lib/client/network-failure"
import type { AcademyStaffMember } from "@/lib/coach/types"
import { getAcademyDateKey } from "@/lib/format"

export function staffAccessLabel(accessLevel: AcademyStaffMember["accessLevel"]) {
  return accessLevel === "head_admin" ? "Head coach" : "Assistant coach"
}

/*
 * Four of this table's six columns describe training, and a coach has none of
 * it. They are written as an explicit em dash with a screen-reader reason
 * rather than left blank: blank in a table reads as data that failed to load,
 * and the responsive layout stacks every cell under its own `data-label`, so a
 * silent gap would be announced as "Sessions" followed by nothing at all.
 */
function NotApplicable({ reason }: { reason: string }) {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{reason}</span>
    </>
  )
}

export function StaffSummaryRow({
  index,
  isExpanded,
  onOpen,
  staff,
}: {
  index: number
  isExpanded: boolean
  onOpen: (memberId: string) => void
  staff: AcademyStaffMember
}) {
  const activated = Boolean(staff.activatedAt)

  return (
    <tr className={isExpanded ? "is-expanded" : undefined}>
      <td className="coach-member-folio" aria-hidden="true">
        {String(index + 1).padStart(2, "0")}
      </td>
      <th scope="row" data-label="Member">
        <span className="coach-member-name">
          <strong>{staff.fullName}</strong>
          <small>{staff.academyId}</small>
        </span>
      </th>
      <td className="coach-member-training" data-label="Training">
        <span>
          <strong>{staffAccessLabel(staff.accessLevel)}</strong>
          <small>Coaching staff</small>
        </span>
      </td>
      <td className="coach-member-sessions" data-label="Sessions">
        <span><NotApplicable reason="Sessions are not assigned to coaching staff" /></span>
      </td>
      <td className="coach-member-joined" data-label="Training from">
        <NotApplicable reason="Coaching staff do not train; joined date is in the details" />
      </td>
      <td className="coach-member-status-cell" data-label="Status">
        <span className={`coach-member-status is-${activated ? "active" : "unassigned"}`}>
          {activated ? "active" : "not activated"}
        </span>
      </td>
      <td className="coach-member-row-action">
        <button
          type="button"
          aria-expanded={isExpanded}
          aria-controls={isExpanded ? `member-details-${staff.id}` : undefined}
          onClick={() => onOpen(staff.id)}
        >
          <span>{isExpanded ? "Close" : "Details"}</span>
          <ChevronDown aria-hidden="true" />
        </button>
      </td>
    </tr>
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
        className="coach-member-save-notice"
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
  return (
    <tr className="coach-member-detail-row">
      <td colSpan={6}>
        {/* The same panel a player's record uses, so a coach's record reads as
            one: it had no styles of its own and rendered as bare stacked text. */}
        <div id={`member-details-${staff.id}`} className="coach-member-detail-panel">
          <div className="coach-member-detail-heading">
            <div>
              <span>Staff record</span>
              <h3>{staff.fullName}</h3>
              <p>{staff.academyId} · {staffAccessLabel(staff.accessLevel)}</p>
            </div>
          </div>
          <div className="coach-member-detail-domains">
            <section aria-labelledby={`staff-profile-${staff.id}`}>
              <span>Profile</span>
              <h4 id={`staff-profile-${staff.id}`}>Staff details</h4>
              <dl>
                <div>
                  <dt>Academy ID</dt>
                  <dd>{staff.academyId}</dd>
                </div>
                <div>
                  <dt>Access</dt>
                  <dd>{staffAccessLabel(staff.accessLevel)}</dd>
                </div>
                <div>
                  <dt>Joined</dt>
                  <dd>{formatJoinedDate(staff.joinedOn)}</dd>
                </div>
              </dl>
            </section>
            <section aria-labelledby={`staff-account-${staff.id}`}>
              <span>Account</span>
              <h4 id={`staff-account-${staff.id}`}>Portal account</h4>
              <dl>
                <div>
                  <dt>Coach approved</dt>
                  <dd>{staff.approvedAt
                    ? formatJoinedDate(getAcademyDateKey(staff.approvedAt))
                    : "Not recorded"}</dd>
                </div>
                <div>
                  <dt>Account activated</dt>
                  <dd>{staff.activatedAt
                    ? formatJoinedDate(getAcademyDateKey(staff.activatedAt))
                    : "Not yet activated"}</dd>
                </div>
              </dl>
            </section>
          </div>
          {staff.accessLevel === "junior_coach"
            ? <StaffAccessActions onArchived={onArchived} staff={staff} />
            : null}
        </div>
      </td>
    </tr>
  )
}

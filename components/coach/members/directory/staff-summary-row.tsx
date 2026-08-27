"use client"

import { ChevronDown } from "lucide-react"

import { formatJoinedDate } from "@/components/coach/members/directory/shared"
import type { AcademyStaffMember } from "@/lib/coach/types"

export function staffAccessLabel(accessLevel: AcademyStaffMember["accessLevel"]) {
  return accessLevel === "head_admin" ? "Head coach" : "Junior coach"
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

export function StaffDetailRow({ staff }: { staff: AcademyStaffMember }) {
  return (
    <tr className="coach-member-detail-row">
      <td colSpan={7}>
        <div id={`member-details-${staff.id}`} className="coach-member-detail">
          <section aria-labelledby={`staff-profile-${staff.id}`}>
            <h3 id={`staff-profile-${staff.id}`}>
              <span className="eyebrow">Profile</span>
              Staff details
            </h3>
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
              <div>
                <dt>Coach approved</dt>
                <dd>{staff.approvedAt
                  ? formatJoinedDate(staff.approvedAt.slice(0, 10))
                  : "Not recorded"}</dd>
              </div>
              <div>
                <dt>Account activated</dt>
                <dd>{staff.activatedAt
                  ? formatJoinedDate(staff.activatedAt.slice(0, 10))
                  : "Not yet activated"}</dd>
              </div>
            </dl>
          </section>
        </div>
      </td>
    </tr>
  )
}

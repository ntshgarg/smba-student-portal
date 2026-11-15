import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }))
vi.mock("@/app/coach/actions", () => ({ archiveCoachAction: vi.fn() }))

import {
  StaffDetailRow,
  StaffSummaryRow,
  staffAccessLabel,
} from "@/components/coach/members/directory/staff-summary-row"
import type { AcademyStaffMember } from "@/lib/coach/types"

/*
 * The Member Directory listed players only, so an approved assistant coach existed
 * nowhere a head coach could look them up. These cards put them in the directory:
 * the player's card and record, with their role in place of training and no
 * tabs, since a coach has no training or fees here.
 */
const junior: AcademyStaffMember = {
  academyId: "SMBA-JC-6442",
  accessLevel: "junior_coach",
  activatedAt: "2026-08-27T09:10:00.000Z",
  approvedAt: "2026-08-27T08:00:00.000Z",
  fullName: "Kavya Iyer",
  id: "staff-1",
  initials: "KI",
  joinedOn: "2026-08-27",
  role: "coach",
}

// A card sets the surname apart (Kavya <em>Iyer</em>), so names are read as text.
function summary(staff: AcademyStaffMember, isExpanded = false) {
  return renderToStaticMarkup(
    <StaffSummaryRow isExpanded={isExpanded} onOpen={() => {}} staff={staff} />,
  ).replace(/<\/?em>/gu, "")
}

function detail(staff: AcademyStaffMember) {
  return renderToStaticMarkup(<StaffDetailRow onArchived={() => {}} staff={staff} />)
}

describe("coaching staff in the Member Directory", () => {
  it("names the role and when they joined in place of training", () => {
    const html = summary(junior)
    expect(html).toContain("Kavya Iyer")
    expect(html).toContain("SMBA-JC-6442")
    expect(html).toContain("Assistant coach")
    expect(html).toContain("Joined 27 Aug 2026")
  })

  it("reports an unactivated account as such rather than as a training status", () => {
    expect(summary(junior)).toContain(">Active<")
    expect(summary({ ...junior, activatedAt: null })).toContain(">Not activated<")
  })

  it("keeps the disclosure wired to the panel it opens", () => {
    expect(summary(junior)).toContain('aria-expanded="false"')
    const open = summary(junior, true)
    expect(open).toContain('aria-expanded="true"')
    expect(open).toContain('aria-controls="member-details-staff-1"')
  })

  it("shows the dates the directory has for a coach, and marks the ones still to come", () => {
    const html = detail(junior)
    expect(html).toContain("Coaching staff · joined 27 Aug 2026")
    expect(html).toContain("Approved")
    expect(html).toContain("Account set up")
    expect(html).not.toContain("is-pending")

    const pending = detail({ ...junior, activatedAt: null, approvedAt: null })
    expect(pending.match(/class="is-pending"/gu)).toHaveLength(2)
    expect(pending).toContain("Not yet")
  })

  it("offers to archive an assistant coach, never the head coach", () => {
    expect(detail(junior)).toContain("Archive coach")
    expect(detail(junior)).toContain("Archiving switches off their sign-in")
    expect(detail({ ...junior, accessLevel: "head_admin" })).not.toContain("Archive coach")
  })

  it("distinguishes the head coach from a assistant coach", () => {
    expect(staffAccessLabel("head_admin")).toBe("Head coach")
    expect(staffAccessLabel("junior_coach")).toBe("Assistant coach")
    expect(summary({ ...junior, accessLevel: "head_admin" })).toContain("Head coach")
  })
})

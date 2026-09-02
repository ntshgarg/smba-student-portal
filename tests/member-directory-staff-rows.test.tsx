import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import {
  StaffDetailRow,
  StaffSummaryRow,
  staffAccessLabel,
} from "@/components/coach/members/directory/staff-summary-row"
import type { AcademyStaffMember } from "@/lib/coach/types"

/*
 * The Member Directory listed players only, so an approved assistant coach existed
 * nowhere a head coach could look them up -- the staff roll call held their name
 * and nothing else. These rows put them in the directory. Four of its six
 * columns describe training, which a coach has none of, so what those cells say
 * is the part worth pinning.
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

function summary(staff: AcademyStaffMember, isExpanded = false) {
  return renderToStaticMarkup(
    <table><tbody>
      <StaffSummaryRow index={0} isExpanded={isExpanded} onOpen={() => {}} staff={staff} />
    </tbody></table>,
  )
}

describe("coaching staff in the Member Directory", () => {
  it("names the access level rather than leaving the training column blank", () => {
    const html = summary(junior)
    expect(html).toContain("Kavya Iyer")
    expect(html).toContain("SMBA-JC-6442")
    expect(html).toContain("Assistant coach")
    expect(html).toContain("Coaching staff")
  })

  it("says why the training columns are empty instead of rendering a silent gap", () => {
    const html = summary(junior)
    expect(html).toContain("Sessions are not assigned to coaching staff")
    expect(html).toContain("Coaching staff do not train")
    // The dash is decoration; the reason is what a screen reader gets.
    expect(html).toContain('aria-hidden="true">—<')
    // The stacked responsive layout labels each cell, so staff rows keep them.
    expect(html).toContain('data-label="Sessions"')
    expect(html).toContain('data-label="Training from"')
  })

  it("reports an unactivated account as such rather than as a training status", () => {
    expect(summary(junior)).toContain(">active<")
    expect(summary({ ...junior, activatedAt: null })).toContain(">not activated<")
  })

  it("keeps the disclosure wired to the panel it opens", () => {
    expect(summary(junior)).toContain('aria-expanded="false"')
    const open = summary(junior, true)
    expect(open).toContain('aria-expanded="true"')
    expect(open).toContain('aria-controls="member-details-staff-1"')
  })

  it("shows the dates the directory has for a coach, and names the ones it lacks", () => {
    const html = renderToStaticMarkup(
      <table><tbody><StaffDetailRow staff={junior} /></tbody></table>,
    )
    expect(html).toContain("Joined")
    expect(html).toContain("27 Aug 2026")
    expect(html).toContain("Coach approved")
    expect(html).toContain("Account activated")

    const pending = renderToStaticMarkup(
      <table><tbody>
        <StaffDetailRow staff={{ ...junior, activatedAt: null, approvedAt: null }} />
      </tbody></table>,
    )
    expect(pending).toContain("Not recorded")
    expect(pending).toContain("Not yet activated")
  })

  it("distinguishes the head coach from a assistant coach", () => {
    expect(staffAccessLabel("head_admin")).toBe("Head coach")
    expect(staffAccessLabel("junior_coach")).toBe("Assistant coach")
    expect(summary({ ...junior, accessLevel: "head_admin" })).toContain("Head coach")
  })
})

import { describe, expect, it, vi } from "vitest"

vi.mock("@/app/coach/members/training-actions", () => ({}))
vi.mock("@/components/coach/coach-portal-provider", () => ({}))

import { archiveBlockedNote } from "@/components/coach/members/directory/member-access-actions"

describe("the archive note on a member record", () => {
  it("names when archiving opens after End training is booked", () => {
    const note = archiveBlockedNote(true, { effectiveOn: "2026-12-01", kind: "end" })
    expect(note).toContain("Training ends after November 2026. Archiving opens from 1 December 2026")
    expect(note).toContain("They have left already")
  })

  it("still names it when the place has already closed", () => {
    expect(archiveBlockedNote(false, { effectiveOn: "2026-12-01", kind: "end" }))
      .toContain("Archiving opens from 1 December 2026")
    // End training is not offered without a place, so the note does not send them there.
    const closed = archiveBlockedNote(false, { effectiveOn: "2026-12-01", kind: "end" })
    expect(closed).toContain("Cancel scheduled change")
    expect(closed).not.toContain("They have left already")
    expect(archiveBlockedNote(false, null)).toBeNull()
  })
})

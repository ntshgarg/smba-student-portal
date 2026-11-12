import { describe, expect, it } from "vitest"

import { archiveBlockedNote } from "@/components/coach/members/directory/member-access-actions"

/*
 * What a member record says stands between the player and Archive. It used to
 * tell a coach who had just booked End training to "use End training", with
 * no word that archiving opens on the day it happens or at once with "They
 * have left already" -- and it offered Archive while a start was booked.
 */
describe("the archive note on a member record", () => {
  it("names when archiving opens after End training is booked", () => {
    const note = archiveBlockedNote(true, { effectiveOn: "2026-12-01", kind: "end" })
    expect(note).toContain("Training ends on 1 December 2026, and archiving opens then")
    expect(note).toContain("They have left already")
    expect(note).not.toContain("Use End training above before archiving")
  })

  it("still asks for End training when nothing is booked", () => {
    expect(archiveBlockedNote(true, null)).toBe("Use End training above before archiving this member.")
  })

  it("holds Archive back while a start of training is booked", () => {
    expect(archiveBlockedNote(false, { effectiveOn: "2026-12-01", kind: "change" }))
      .toContain("Cancel that booked change above before archiving")
  })

  it("offers Archive for a player off every schedule with nothing booked", () => {
    expect(archiveBlockedNote(false, null)).toBeNull()
  })
})

import { describe, expect, it } from "vitest"

import { normalizeInlineNoticeMessage } from "@/components/inline-notice"

describe("normalizeInlineNoticeMessage", () => {
  it("removes trailing punctuation from short action feedback", () => {
    expect(normalizeInlineNoticeMessage("Attendance saved and synced.")).toBe(
      "Attendance saved and synced",
    )
    expect(normalizeInlineNoticeMessage("The schedule could not be created!!")).toBe(
      "The schedule could not be created",
    )
  })

  it("preserves punctuation inside a message", () => {
    expect(normalizeInlineNoticeMessage("Saved for Mon, Wed and Fri.")).toBe(
      "Saved for Mon, Wed and Fri",
    )
  })
})

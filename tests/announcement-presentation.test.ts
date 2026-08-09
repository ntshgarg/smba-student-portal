import { describe, expect, it } from "vitest"

import {
  announcementIsNew,
  announcementParagraphs,
  sortAnnouncements,
} from "@/components/announcements/announcement-presentation"

describe("announcement presentation", () => {
  it("uses one plain-text paragraph rule across announcement surfaces", () => {
    expect(announcementParagraphs("  First paragraph.\n\n  Second paragraph.  ")).toEqual([
      "First paragraph.",
      "  Second paragraph.",
    ])
    expect(announcementParagraphs("Line one.\n   \nLine two.")).toEqual([
      "Line one.",
      "Line two.",
    ])
  })

  it("treats the publication day and previous six academy calendar days as new", () => {
    const reference = new Date("2026-08-09T12:00:00.000Z")

    expect(announcementIsNew("2026-08-09T00:30:00.000Z", reference)).toBe(true)
    expect(announcementIsNew("2026-08-02T18:30:00.000Z", reference)).toBe(true)
    expect(announcementIsNew("2026-08-02T18:29:59.000Z", reference)).toBe(false)
  })

  it("places pinned announcements first and otherwise orders newest first", () => {
    const announcements = [
      { pinned: false, publishedAt: "2026-08-09T08:00:00.000Z", title: "Newest" },
      { pinned: true, publishedAt: "2026-08-01T08:00:00.000Z", title: "Pinned" },
      { pinned: false, publishedAt: "2026-08-08T08:00:00.000Z", title: "Older" },
    ]

    expect(sortAnnouncements(announcements).map((item) => item.title)).toEqual([
      "Pinned",
      "Newest",
      "Older",
    ])
  })
})

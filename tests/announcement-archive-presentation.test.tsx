import { renderToStaticMarkup } from "react-dom/server"

import { describe, expect, it } from "vitest"

import {
  PublishedAnnouncementArchive,
  type AnnouncementArchiveQuery,
} from "@/components/coach/announcements/announcement-archive"
import type { CoachAnnouncementSummary } from "@/components/coach/announcements/contracts"

const query: AnnouncementArchiveQuery = {
  channel: "all",
  month: "2026-08",
  query: "",
  status: "all",
}

const announcement: CoachAnnouncementSummary = {
  audience: "everyone",
  channels: ["homepage"],
  expiresOn: null,
  id: "announcement-1",
  pinned: false,
  presentationRevision: 1,
  preview: "The academy will be closed on Monday.",
  publishedAt: "2026-08-09T04:30:00.000Z",
  publishedByAccountId: "coach-1",
  status: "active",
  title: "Academy holiday",
  withdrawal: null,
}

describe("Published Announcement archive presentation", () => {
  it("shows one focused creation action when the archive has no publications", () => {
    const html = renderToStaticMarkup(
      <PublishedAnnouncementArchive
        announcements={[]}
        currentMonth="2026-08"
        hasPublishedAnnouncements={false}
        query={query}
      />,
    )

    expect(html).toContain('aria-labelledby="announcement-empty-title"')
    expect(html).toContain('<h2 id="announcement-empty-title">No announcements yet.</h2>')
    expect(html.match(/href="\/coach\/announcements\/new"/gu)).toHaveLength(1)
    expect(html).toContain("Write the first announcement")
    expect(html).not.toContain("Choose announcement month")
    expect(html).not.toContain("announcement-search")
    expect(html).not.toContain("Notice board history")
    expect(html).not.toContain("Filters")
  })

  it("retains archive controls and filtered no-match behavior once publications exist", () => {
    const populatedHtml = renderToStaticMarkup(
      <PublishedAnnouncementArchive
        announcements={[announcement]}
        currentMonth="2026-08"
        hasPublishedAnnouncements
        query={query}
      />,
    )
    const filteredHtml = renderToStaticMarkup(
      <PublishedAnnouncementArchive
        announcements={[]}
        currentMonth="2026-08"
        hasPublishedAnnouncements
        query={{ ...query, query: "training" }}
      />,
    )

    expect(populatedHtml).toContain('aria-label="Choose announcement month"')
    expect(populatedHtml).toContain('id="announcement-search"')
    expect(populatedHtml).toContain("Notice board history")
    expect(populatedHtml).toContain("Academy holiday")
    expect(filteredHtml).toContain("No matching announcements.")
    expect(filteredHtml).toContain("Clear search and filters")
    expect(filteredHtml).toContain('id="announcement-search"')
  })
})

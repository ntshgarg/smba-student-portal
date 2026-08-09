import { renderToStaticMarkup } from "react-dom/server"

import { describe, expect, it } from "vitest"

import { PublishedReportsList } from "@/components/coach/reports/published-reports-list"
import type { CoachPublishedReportSummary } from "@/lib/reports/coach-archive"

function reports(count: number): CoachPublishedReportSummary[] {
  return Array.from({ length: count }, (_, index) => {
    const ordinal = index + 1
    return {
      reportId: `report-${ordinal}`,
      playerId: `player-${ordinal}`,
      playerName: `Player ${String(ordinal).padStart(2, "0")}`,
      academyId: `SMBA#${String(ordinal).padStart(4, "0")}`,
      playerArchived: false,
      month: "2026-07",
      latestPublicationId: `publication-${ordinal}`,
      latestRevision: 1,
      revisionCount: 1,
      latestPublishedAt: "2026-08-03T04:30:00.000Z",
    }
  })
}

describe("Published Reports progressive reveal", () => {
  it("renders only the initial ten reports while retaining a single reveal control", () => {
    const html = renderToStaticMarkup(
      <PublishedReportsList
        initialShown={10}
        period="2026-07"
        periodLabel="July 2026"
        query=""
        reports={reports(11)}
      />,
    )

    expect(html.match(/<article/g)).toHaveLength(10)
    expect(html).toContain("Player 10")
    expect(html).not.toContain("Player 11")
    expect(html).toContain("Show more reports")
    expect(html).toContain("Showing 10 of 11 published reports")
  })

  it("removes the reveal control at the final depth and preserves that depth in detail links", () => {
    const html = renderToStaticMarkup(
      <PublishedReportsList
        initialShown={11}
        period="2026-07"
        periodLabel="July 2026"
        query="Aditi Rao"
        reports={reports(11)}
      />,
    )

    expect(html.match(/<article/g)).toHaveLength(11)
    expect(html).toContain("Player 11")
    expect(html).not.toContain("Show more reports")
    expect(html).toContain("period=2026-07&amp;q=Aditi+Rao&amp;shown=11")
  })
})

import { renderToStaticMarkup } from "react-dom/server"

import { describe, expect, it } from "vitest"

import { PublishedReportsArchive } from "@/components/coach/reports/published-reports"

function renderArchive({
  hasPublishedReports = true,
  period = "2026-07",
  periodHasPublications = true,
}: {
  hasPublishedReports?: boolean
  period?: string
  periodHasPublications?: boolean
} = {}) {
  return renderToStaticMarkup(
    <PublishedReportsArchive
      hasPublishedReports={hasPublishedReports}
      latestCompletedPeriod="2026-07"
      period={period}
      periodHasPublications={periodHasPublications}
      query=""
      reports={[]}
      shown={0}
    />,
  )
}

describe("Published Reports month control", () => {
  it("allows browsing before the earliest month that contains a publication", () => {
    const html = renderArchive()

    expect(html).toContain("period=2026-06")
    expect(html).toContain("Show June 2026 published reports")
    expect(html).not.toContain("period=2026-08")
  })

  it("allows moving in both directions from an empty completed month", () => {
    const html = renderArchive({
      period: "2026-06",
      periodHasPublications: false,
    })

    expect(html).toContain("period=2026-05")
    expect(html).toContain("period=2026-07")
    expect(html).toContain("No reports for June 2026.")
  })

  it("keeps navigation unavailable before the archive has any publications", () => {
    const html = renderArchive({
      hasPublishedReports: false,
      periodHasPublications: false,
    })

    expect(html).not.toContain("Show June 2026 published reports")
    expect(html).toContain("No published reports yet.")
  })
})

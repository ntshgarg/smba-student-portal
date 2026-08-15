import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  search: "",
}))

vi.mock("next/navigation", () => ({
  usePathname: () => "/player/reports",
  useRouter: () => ({ push: navigation.push }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

import { ReportAccordion } from "@/components/reports/report-accordion"
import type { PlayerReportArchiveItem } from "@/lib/types"

const reports: PlayerReportArchiveItem[] = [
  {
    id: "jul-id",
    month: "2026-07",
    monthLabel: "July 2026",
    publishedAt: "2026-08-01T03:30:00.000Z",
    reportText: "July first paragraph.\n\nJuly second paragraph.",
  },
  {
    id: "jun-id",
    month: "2026-06",
    monthLabel: "June 2026",
    publishedAt: "2026-07-03T03:30:00.000Z",
    reportText: "June report.",
  },
  {
    id: "may-id",
    month: "2026-05",
    monthLabel: "May 2026",
    publishedAt: "2026-06-03T03:30:00.000Z",
    reportText: "May report.",
  },
  {
    id: "dec-id",
    month: "2025-12",
    monthLabel: "December 2025",
    publishedAt: "2026-01-03T03:30:00.000Z",
    reportText: "December coach note.",
  },
]

function renderArchive() {
  return renderToStaticMarkup(
    <ReportAccordion playerName="Aarav Bhat" reports={reports} />,
  ).replaceAll("<!-- -->", "")
}

function matches(html: string, pattern: RegExp) {
  return html.match(pattern) ?? []
}

describe("player report Season Ledger", () => {
  beforeEach(() => {
    navigation.search = ""
    vi.clearAllMocks()
  })

  it("renders aligned year chapters with local decorative folios", () => {
    const html = renderArchive()

    expect(matches(html, /class="report-season-label"/gu)).toHaveLength(2)
    expect(matches(html, /class="report-season-year"/gu)).toHaveLength(2)
    expect(html).toContain("3 coach reports")
    expect(html).toContain("1 coach report")
    expect(html).toMatch(/aria-expanded="true" class="report-year-trigger" id="report-year-2026-trigger"/u)
    expect(html).toMatch(/aria-expanded="false" class="report-year-trigger" id="report-year-2025-trigger"/u)
    expect(matches(html, /class="report-month-trigger"/gu)).toHaveLength(3)
    expect(matches(html, /aria-expanded="false" class="report-month-trigger"/gu)).toHaveLength(3)
    expect(matches(html, /class="report-month-folio"/gu)).toHaveLength(3)
    expect(matches(html, /aria-hidden="true" class="report-month-folio"/gu)).toHaveLength(3)
    expect(html).toContain('class="report-month-folio">03</span>')
    expect(html).toContain('class="report-month-folio">02</span>')
    expect(html).toContain('class="report-month-folio">01</span>')
    expect(html).not.toContain("expanded-report-panel")
  })

  it("resets folios per year and restores a deep-linked report", () => {
    navigation.search = "year=2025&report=dec-id"
    const html = renderArchive()

    expect(html).toMatch(/aria-expanded="false" class="report-year-trigger" id="report-year-2026-trigger"/u)
    expect(html).toMatch(/aria-expanded="true" class="report-year-trigger" id="report-year-2025-trigger"/u)
    expect(html).toMatch(/aria-expanded="true" class="report-month-trigger" id="dec-id-trigger"/u)
    expect(matches(html, /class="report-month-folio"/gu)).toHaveLength(1)
    expect(html).toContain('class="report-month-folio">01</span>')
    expect(html).toContain("December coach note.")
    expect(html).toContain("Download December 2025 report")
    expect(html).toContain('href="/player/reports/dec-id/download"')
  })

  it("keeps every chapter closed when the URL requests no year", () => {
    navigation.search = "year=none"
    const html = renderArchive()

    expect(matches(html, /aria-expanded="false" class="report-year-trigger"/gu)).toHaveLength(2)
    expect(html).not.toContain("report-year-panel")
    expect(html).not.toContain("report-month-trigger")
  })
})

import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  search: "",
}))

vi.mock("next/navigation", () => ({
  usePathname: () => "/coach",
  useRouter: () => ({
    push: navigation.push,
    replace: navigation.replace,
  }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

import {
  JuniorCoachAttendanceCard,
  type JuniorCoachAttendanceView,
} from "@/components/coach/junior-coach-attendance-card"
import { PlayerFeeRecordCard } from "@/components/financials/player-fee-record-card"
import { Reveal } from "@/components/reveal"

const attendance: JuniorCoachAttendanceView = {
  joinedOn: "2026-08-01",
  monthLabel: "August 2026",
  referenceDate: "2026-08-11",
  records: [{ choice: "present", dateKey: "2026-08-01" }],
  summary: {
    absent: 0,
    percentage: 100,
    present: 1,
    recorded: 1,
  },
  years: [2026],
}

// An opacity gate in the served markup can only be cleared by client
// JavaScript, so anything wrapped in a Reveal disappears for the whole session
// when hydration never happens.
const opacityGate = /opacity\s*:\s*0/

describe("reveal visibility floor", () => {
  it("serves revealed content without an opacity gate", () => {
    const html = renderToStaticMarkup(
      <Reveal className="dashboard-card">Attendance summary</Reveal>,
    )

    expect(html).toContain("Attendance summary")
    expect(html).not.toMatch(opacityGate)
    expect(html).not.toContain("translateY")
  })

  it("staggers a delayed reveal without hiding it first", () => {
    const html = renderToStaticMarkup(
      <Reveal delay={0.08}>Fee record</Reveal>,
    )

    expect(html).toContain("animation-delay:0.08s")
    expect(html).not.toMatch(opacityGate)
  })

  it("serves the assistant coach attendance card visibly", () => {
    const html = renderToStaticMarkup(
      <JuniorCoachAttendanceCard attendance={attendance} />,
    )

    expect(html).toContain("Personal roll-call ledger")
    expect(html).toContain("Open attendance record")
    expect(html).not.toMatch(opacityGate)
  })

  it("serves the player fee record card visibly", () => {
    const html = renderToStaticMarkup(<PlayerFeeRecordCard summary={null} />)

    expect(html).toContain("Fee record")
    expect(html).not.toMatch(opacityGate)
  })
})

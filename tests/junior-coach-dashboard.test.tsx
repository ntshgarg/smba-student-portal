import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import {
  JuniorCoachAttendanceCard,
  type JuniorCoachAttendanceView,
} from "@/components/coach/junior-coach-attendance-card"
import { JuniorCoachWelcomeHero } from "@/components/coach/junior-coach-welcome-hero"

const attendance: JuniorCoachAttendanceView = {
  joinedOn: "2026-08-01",
  monthLabel: "August 2026",
  referenceDate: "2026-08-11",
  records: [
    { choice: "present", dateKey: "2026-08-01" },
    { choice: "present", dateKey: "2026-08-02" },
    { choice: "present", dateKey: "2026-08-03" },
    { choice: "absent", dateKey: "2026-08-04" },
  ],
  summary: {
    absent: 1,
    percentage: 75,
    present: 3,
    recorded: 4,
  },
  years: [2025, 2026, 2027],
}

describe("junior coach dashboard", () => {
  it("reuses the head-coach hero geometry without an operational ribbon", () => {
    const html = renderToStaticMarkup(
      <JuniorCoachWelcomeHero coachName="Arun" greeting="Good morning" />,
    )

    expect(html).toContain("coach-welcome-scoreboard")
    expect(html).toContain("coach-scoreboard-court")
    expect(html).toContain('<rect x="20" y="20" width="1300" height="570"></rect>')
    expect(html).toContain("Good morning")
    expect(html).toContain("Arun.")
    expect(html).toContain("Your attendance record stays quietly in view.")
    expect(html).not.toContain("coach-scoreboard-ribbon")
  })

  it("summarizes personal attendance as a roll-call ledger ticket", () => {
    const html = renderToStaticMarkup(
      <JuniorCoachAttendanceCard attendance={attendance} />,
    )

    expect(html).toContain("Personal roll-call ledger")
    expect(html).toContain("August 2026")
    expect(html).toContain("75%")
    expect(html).toContain("Recorded days")
    expect(html).toContain(">04<")
    expect(html).toContain("Present")
    expect(html).toContain(">03<")
    expect(html).toContain("Absent")
    expect(html).toContain(">01<")
    expect(html).toContain("Open attendance record")
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('id="junior-coach-attendance-register"')
  })

  it("keeps the ledger useful before the first recorded day", () => {
    const html = renderToStaticMarkup(
      <JuniorCoachAttendanceCard
        attendance={{
          ...attendance,
          records: [],
          summary: {
            absent: 0,
            percentage: null,
            present: 0,
            recorded: 0,
          },
        }}
      />,
    )

    expect(html).toContain("Your record will appear after the head coach saves an attendance day.")
    expect(html).toContain(">00<")
    expect(html).toContain("Open attendance record")
  })
})

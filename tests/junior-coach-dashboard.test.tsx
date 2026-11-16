import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

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
import { JuniorCoachWelcomeHero } from "@/components/coach/junior-coach-welcome-hero"

const attendance: JuniorCoachAttendanceView = {
  holidays: [],
  joinedOn: "2026-08-01",
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

describe("assistant coach dashboard", () => {
  beforeEach(() => {
    navigation.search = ""
    vi.clearAllMocks()
  })

  it("reuses the head-coach hero geometry without an operational ribbon", () => {
    const html = renderToStaticMarkup(
      <JuniorCoachWelcomeHero coachName="Arun" greeting="Good morning" />,
    )

    expect(html).toContain("coach-welcome-scoreboard")
    expect(html).toContain("coach-scoreboard-court")
    expect(html).toContain('<rect x="20" y="20" width="1300" height="570"></rect>')
    expect(html).toContain("Good morning")
    expect(html).toContain("Arun.")
    expect(html).toContain("Here’s your month so far.")
    expect(html).not.toContain("coach-scoreboard-ribbon")
  })

  it("shows this month as a big percentage beside a calendar of full tiles", () => {
    const html = renderToStaticMarkup(
      <JuniorCoachAttendanceCard attendance={attendance} />,
    )

    expect(html).toContain(">My attendance</h2>")
    expect(html).toContain("August 2026")
    expect(html).toContain("75%")
    expect(html).toContain("Present on 3 of 4 marked days")
    expect(html).toContain("<dt>Present</dt><dd>3</dd>")
    expect(html).toContain("<dt>Absent</dt><dd>1</dd>")
    expect(html).toContain('aria-label="Your attendance calendar for August 2026"')
    expect(html.match(/role="columnheader"/g)).toHaveLength(7)
    expect(html.match(/role="row"/g)).toHaveLength(7)
    expect(html.match(/role="gridcell"/g)).toHaveLength(42)
    expect(html).toContain('aria-rowcount="7"')
    // August 2026 runs Saturday the 1st to Monday the 31st: 31 dated tiles
    expect(html.match(/role="gridcell"[^>]*aria-label=/g)).toHaveLength(31)
    expect(html).toContain('data-state="present" role="gridcell" aria-label="Saturday, 1 August 2026: present"')
    expect(html).toContain('data-state="absent" role="gridcell" aria-label="Tuesday, 4 August 2026: absent"')
    expect(html).toContain('data-state="unmarked" role="gridcell" aria-label="Wednesday, 5 August 2026: not recorded"')
    expect(html).toContain('role="gridcell" aria-current="date" aria-label="Tuesday, 11 August 2026: not recorded"')
    expect(html).toContain('data-state="upcoming" role="gridcell" aria-label="Wednesday, 12 August 2026: upcoming"')
    for (const label of ["Present", "Absent", "Holiday", "Not recorded", "Upcoming"]) {
      expect(html).toContain(`</i>${label}</span>`)
    }
    // nothing in August is before joining, so that key is left out
    expect(html).not.toContain("Not available")
    expect(html).toContain('aria-label="Earlier months: view July 2026"')
    expect(html).not.toContain("Later month")
  })

  it("keeps the card useful before the first recorded day", () => {
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

    expect(html).toContain("—")
    expect(html).toContain("Your record will appear after the head coach saves an attendance day.")
    expect(html).toContain("<dt>Present</dt><dd>0</dd>")
    expect(html).toContain("Earlier months")
  })

  it("opens an earlier month from the address and counts it from its tiles", () => {
    navigation.search = "attendance=register&month=07"
    const html = renderToStaticMarkup(
      <JuniorCoachAttendanceCard
        attendance={{
          ...attendance,
          joinedOn: "2026-07-15",
          holidays: [{ dateKey: "2026-07-20", label: "Bandh" }],
          records: [
            ...attendance.records,
            { choice: "present", dateKey: "2026-07-15" },
            { choice: "absent", dateKey: "2026-07-16" },
            { choice: "present", dateKey: "2026-07-20" },
          ],
        }}
      />,
    )

    expect(html).toContain('aria-label="Your attendance calendar for July 2026"')
    expect(html).toContain("50%")
    expect(html).toContain("Present on 1 of 2 marked days")
    expect(html).toContain('data-state="closed" role="gridcell" aria-label="Monday, 20 July 2026: academy closed for Bandh"')
    expect(html).toContain('data-state="unavailable" role="gridcell" aria-label="Tuesday, 14 July 2026: not available"')
    expect(html).toContain("Not available</span>")
    expect(html).toContain('aria-label="Earlier months: view June 2026"')
    expect(html).toContain('aria-label="Later month: view August 2026"')
  })
})

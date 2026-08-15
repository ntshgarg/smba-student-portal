import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CoachWelcomeHero } from "@/components/coach/coach-welcome-hero"
import { currentGreeting } from "@/lib/greeting"

afterEach(() => {
  vi.useRealTimers()
})

describe("academy-time dashboard greetings", () => {
  it.each([
    ["2026-08-10T06:29:00.000Z", "Good morning"],
    ["2026-08-10T06:30:00.000Z", "Good afternoon"],
    ["2026-08-10T11:29:00.000Z", "Good afternoon"],
    ["2026-08-10T11:30:00.000Z", "Good evening"],
  ])("uses the academy-time boundary at %s", (instant, expected) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(instant))

    expect(currentGreeting()).toBe(expected)
  })

  it("renders the greeting supplied by the head-coach route", () => {
    const html = renderToStaticMarkup(
      <CoachWelcomeHero
        coachName="Sathiya"
        dateLabel="Monday, 10 August"
        dateTime="2026-08-10"
        greeting="Good morning"
        upcomingSession={null}
        sessionCount={0}
        sessionPosition="first"
      />,
    )

    expect(html).toContain("Good morning")
    expect(html).not.toContain("Good evening")
    expect(html).toContain("coach-welcome-scoreboard")
    expect(html).toContain("coach-scoreboard-ribbon is-empty")
    expect(html).toContain('<rect x="20" y="20" width="1300" height="570"></rect>')
    expect(html).toContain('href="#attendance"')
    expect(html).toContain("Today’s attendance")
    expect(html).not.toContain('href="#onboarding"')
  })

  it("renders today’s session as a scoreboard ribbon", () => {
    const html = renderToStaticMarkup(
      <CoachWelcomeHero
        coachName="Sathiya"
        dateLabel="Monday, 10 August"
        dateTime="2026-08-10"
        greeting="Good morning"
        upcomingSession={{
          time: "6:00 am",
          title: "Beginner · Weekday · 6–7 am",
          venue: "SMBA Court",
        }}
        sessionCount={8}
        sessionPosition="first"
      />,
    )

    expect(html).toContain("coach-scoreboard-ribbon has-session")
    expect(html).toContain("Sessions today")
    expect(html).toContain("coach-session-count-metric")
    expect(html).toContain("coach-time-metric")
    expect(html).toContain("First session")
    expect(html).not.toContain("First batch")
    expect(html).not.toContain("Next batch")
    expect(html).toContain("6:00 am")
    expect(html).toContain("Beginner · Weekday · 6–7 am")
    expect(html).toContain("SMBA Court")
  })

  it("labels the upcoming time as the next session after the first batch", () => {
    const html = renderToStaticMarkup(
      <CoachWelcomeHero
        coachName="Sathiya"
        dateLabel="Monday, 10 August"
        dateTime="2026-08-10"
        greeting="Good morning"
        upcomingSession={{
          time: "10:00 am",
          title: "Intermediate · Weekday · 10–11 am",
          venue: "SMBA Court",
        }}
        sessionCount={8}
        sessionPosition="next"
      />,
    )

    expect(html).toContain("Next session")
    expect(html).toContain("Next on court")
    expect(html).not.toContain("First session")
  })
})

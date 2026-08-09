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
  })
})

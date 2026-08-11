import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { WelcomeHero } from "@/components/dashboard/welcome-hero"

const student = {
  academyId: "SMBA#0002",
  firstName: "Mira",
  fullName: "Mira Rao",
  initials: "MR",
  playerId: "player-2",
}

const coachMessage = {
  coachName: "Coach Sathiya",
  message: "Stay patient and prepare early.",
}

describe("player welcome scoreboard", () => {
  it("keeps training logistics below the hero and renders only the coach note in its ribbon", () => {
    const html = renderToStaticMarkup(
      <WelcomeHero
        student={student}
        coachMessage={coachMessage}
        greeting="Good morning"
        scrollLabel="Your training week"
      />,
    )

    expect(html).toContain("player-welcome-scoreboard")
    expect(html).toContain("player-scoreboard-ribbon is-empty")
    expect(html).not.toContain("Next session")
    expect(html).not.toContain("Starts")
    expect(html).not.toContain("Duration")
    expect(html).toContain("From Coach Sathiya")
    expect(html).toContain("Stay patient and prepare early.")
    expect(html).toContain("Your training week")
    expect(html).toContain('<rect x="20" y="20" width="1300" height="570"></rect>')
  })
})

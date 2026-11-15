import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  contact,
  createTrialMessage,
  enrollmentTerms,
  trainingPrograms,
  weekdayPrograms,
  weekendPrograms,
} from "@/lib/public/academy"

describe("public academy facts", () => {
  it("keeps the approved programme taxonomy and fee guide intact", () => {
    expect(trainingPrograms.map((program) => program.title)).toEqual([
      "Beginner",
      "Intermediate",
      "Advanced",
      "Adult",
    ])
    expect(weekdayPrograms).toEqual([
      { name: "Beginner", duration: "1 hour", fees: { 3: 3500, 4: 4000, 5: 4500 } },
      { name: "Intermediate", duration: "2 hours", fees: { 3: 6000, 4: 6500, 5: 7000 } },
      { name: "Advanced", duration: "3 hours", fees: { 5: 12500 } },
      { name: "Adult", duration: "1 hour", fees: { 3: 4000, 4: 4500, 5: 5000 } },
    ])
    // Advanced trains five weekdays, so it has no weekend price to publish.
    expect(weekendPrograms).toEqual([
      { name: "Beginner", duration: "1 hour", fee: 3000 },
      { name: "Intermediate", duration: "1.5 hours", fee: 5000 },
      { name: "Adult", duration: "1 hour", fee: 3500 },
    ])
  })

  /*
   * Elite is an internal level. Its terms are agreed per player, so there is no
   * price to advertise and the public site must never name it.
   *
   * Asserted over the serialised whole rather than by extending the arrays above:
   * those check the shape that exists, this one catches Elite arriving anywhere
   * in it -- a new marketing blurb, a fee row, a duration string.
   */
  it("never advertises Elite, which has no published fee", () => {
    expect(JSON.stringify({ trainingPrograms, weekdayPrograms, weekendPrograms }))
      .not.toContain("Elite")
  })

  it("keeps registration and official contact details verified", () => {
    expect(enrollmentTerms).toEqual({
      registrationFee: 1000,
      registrationIsNonRefundable: true,
      registrationIncludes: ["a welcome kit", "assessment reports"],
    })
    expect(contact.phone).toBe("+917010928404")
    expect(contact.venue).toBe("Just Play, Mahadevapura")
    expect(contact.maps).toContain("query=Just+Play+Mahadevapura+Bengaluru")
    expect(contact.academyInstagram.handle).toBe("@smbaacademy")
    expect(contact.coachInstagram.handle).toBe("@badmintoncoach_sathiya")
  })

  it("describes monthly prices as a coach-agreed guide without automatic discounts", () => {
    const planner = readFileSync(
      path.join(process.cwd(), "components/public/home-interactions.tsx"),
      "utf8",
    )
    const normalizedPlanner = planner.replace(/\s+/gu, " ")

    expect(normalizedPlanner).toContain("Standard guide price.")
    expect(normalizedPlanner).toContain("Your coach confirms each member’s final monthly fee")
    expect(normalizedPlanner).toContain("any special concession is agreed directly with the coach")
    expect(normalizedPlanner).toContain("payable when you register")
    expect(planner).not.toContain("verified monthly fee")
    expect(planner).not.toContain("Save with a longer plan")
  })

  it("prepares the free-trial WhatsApp handoff without storing form data", () => {
    const url = createTrialMessage({
      name: "Nitish",
      level: "Beginner",
      schedule: "Weekend",
      callback: true,
      note: "Morning preferred",
    })

    expect(url.startsWith(`${contact.whatsapp}?text=`)).toBe(true)
    expect(decodeURIComponent(url)).toContain("Name: Nitish")
    expect(decodeURIComponent(url)).toContain("Preferred schedule: Weekend")
    expect(decodeURIComponent(url)).toContain("Note: Morning preferred")
  })
})

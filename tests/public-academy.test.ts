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
    expect(weekendPrograms).toEqual([
      { name: "Beginner", duration: "1 hour", fee: 3000 },
      { name: "Intermediate", duration: "1.5 hours", fee: 5000 },
      { name: "Advanced", duration: "2 hours", fee: 7000 },
      { name: "Adult", duration: "1 hour", fee: 3500 },
    ])
  })

  it("keeps registration and official contact details verified", () => {
    expect(enrollmentTerms).toEqual({
      registrationFee: 1000,
      registrationIsNonRefundable: true,
      registrationIncludes: ["a welcome kit", "assessment reports"],
    })
    expect(contact.phone).toBe("+917010928404")
    expect(contact.location).toBe("Just Play, Mahadevapura, Bengaluru")
    expect(contact.academyInstagram.handle).toBe("@sathiyamoorthybadmintonacademy")
    expect(contact.coachInstagram.handle).toBe("@badmintoncoach_sathiya")
  })

  it("describes monthly prices as a coach-agreed guide without automatic discounts", () => {
    const feeExplorer = readFileSync(
      path.join(process.cwd(), "components/public/home-interactions.tsx"),
      "utf8",
    )
    const normalizedFeeExplorer = feeExplorer.replace(/\s+/gu, " ")

    expect(normalizedFeeExplorer).toContain("These standard guide prices are based on programme and schedule.")
    expect(normalizedFeeExplorer).toContain("Standard guide · {scheduleLabel} {selected.name}")
    expect(normalizedFeeExplorer).toContain("Any special concession is agreed directly with the coach")
    expect(normalizedFeeExplorer).toContain("payable when you register")
    expect(feeExplorer).not.toContain("verified monthly fee")
    expect(feeExplorer).not.toContain("Save with a longer plan")
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

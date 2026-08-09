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

  it("keeps registration, longer-plan savings and official contact details verified", () => {
    expect(enrollmentTerms).toEqual({
      registrationFee: 1000,
      registrationIsNonRefundable: true,
      registrationIncludes: ["a welcome kit", "assessment reports"],
      longerPlanSavings: [
        { label: "Quarterly", percentage: 5 },
        { label: "Half-yearly", percentage: 7 },
        { label: "Annual", percentage: 10 },
      ],
    })
    expect(contact.phone).toBe("+917010928404")
    expect(contact.location).toBe("Just Play, Mahadevapura, Bengaluru")
    expect(contact.academyInstagram.handle).toBe("@sathiyamoorthybadmintonacademy")
    expect(contact.coachInstagram.handle).toBe("@badmintoncoach_sathiya")
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

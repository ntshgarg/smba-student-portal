import { describe, expect, it } from "vitest"

import {
  ASSESSMENT_SECTIONS,
  ASSESSMENT_SKILLS,
  ASSESSMENT_SKILL_COUNT,
  countRated,
  overallRating,
  parseStoredRatings,
  sectionRating,
  validateAssessmentRatings,
} from "@/lib/assessments/rubric"

describe("assessment rubric", () => {
  it("matches the coach's template: eleven skills in five sections", () => {
    expect(ASSESSMENT_SECTIONS).toHaveLength(5)
    expect(ASSESSMENT_SKILL_COUNT).toBe(11)
    expect(new Set(ASSESSMENT_SKILLS.map((skill) => skill.key)).size).toBe(11)
  })

  it("averages only what was rated, to one decimal, and shows nothing for nothing", () => {
    expect(overallRating({})).toBeNull()
    expect(overallRating({ footwork: 4 })).toBe(4)
    expect(overallRating({ footwork: 4, "mental-focus": 3, "shot-consistency": 3 })).toBe(3.3)
    expect(countRated({ footwork: 4, "mental-focus": 3 })).toBe(2)
  })

  it("rates a section from its own skills", () => {
    const [technical] = ASSESSMENT_SECTIONS
    expect(sectionRating(technical, { "stroke-technique": 5, "shot-consistency": 4, footwork: 1 })).toBe(4.5)
    expect(sectionRating(technical, { footwork: 1 })).toBeNull()
  })

  it("refuses ratings the form could never have sent", () => {
    expect(validateAssessmentRatings({ footwork: 5 })).toEqual({ ok: true, ratings: { footwork: 5 } })
    for (const bad of [{ footwork: 0 }, { footwork: 6 }, { footwork: 2.5 }, { footwork: "3" }, { nope: 3 }, [], null, "x"]) {
      expect(validateAssessmentRatings(bad).ok).toBe(false)
    }
  })

  it("reads stored ratings leniently: a skill this version dropped does not break the page", () => {
    expect(parseStoredRatings('{"footwork":4,"retired-skill":3,"mental-focus":9}')).toEqual({ footwork: 4 })
    expect(parseStoredRatings("not json")).toEqual({})
    expect(parseStoredRatings(null)).toEqual({})
  })
})

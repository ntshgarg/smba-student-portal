/**
 * The coach's player assessment, as set out in the academy's own template (the
 * Word document "SMBA_Player_Performance_Assessment", kept outside this
 * repository): eleven skills in five sections, each rated 1 to 5, plus three
 * written answers.
 *
 * This file is pure data and arithmetic with no server or browser imports, so
 * the form, the service that validates a save, and the pages that show a
 * published assessment all read the same list. The template's "Performance
 * Overview" table repeats five skills that sections 2 to 5 already rate, so it
 * is not asked for twice: the overview is the section averages worked out here.
 *
 * Ratings are stored by skill key, never by position, so a skill can be added
 * later without re-reading every old assessment as something else.
 */

export const ASSESSMENT_RATING_MIN = 1
export const ASSESSMENT_RATING_MAX = 5

export const ASSESSMENT_RATING_LABELS: Readonly<Record<number, string>> = {
  1: "Improvement needed",
  2: "Fair",
  3: "Good",
  4: "Very good",
  5: "Excellent",
}

export const ASSESSMENT_TEXT_MAX_LENGTH = 2_000

export type AssessmentSkill = {
  hint: string
  key: string
  label: string
}

export type AssessmentSection = {
  id: string
  skills: readonly AssessmentSkill[]
  title: string
}

export const ASSESSMENT_SECTIONS: readonly AssessmentSection[] = [
  {
    id: "technical",
    title: "Technical Skills",
    skills: [
      { key: "stroke-technique", label: "Stroke Technique", hint: "Grip, swing, accuracy and shot variety" },
      { key: "shot-consistency", label: "Shot Consistency", hint: "Control, depth and placement" },
    ],
  },
  {
    id: "movement",
    title: "Movement & Physical Performance",
    skills: [
      { key: "footwork", label: "Footwork", hint: "Speed, balance, reaction and efficiency" },
      { key: "court-coverage", label: "Movement & Court Coverage", hint: "Reach, recovery and positioning" },
      { key: "physical-fitness", label: "Physical Fitness", hint: "Speed, strength, endurance and agility" },
    ],
  },
  {
    id: "game",
    title: "Game & Mental Performance",
    skills: [
      { key: "tactical-awareness", label: "Tactical Awareness", hint: "Decision-making and game understanding" },
      { key: "mental-focus", label: "Mental Focus", hint: "Concentration, confidence and composure" },
    ],
  },
  {
    id: "discipline",
    title: "Discipline",
    skills: [
      { key: "attendance-punctuality", label: "Attendance & Punctuality", hint: "Regularity and on-time arrival" },
      { key: "discipline-attitude", label: "Discipline & Attitude", hint: "Behaviour, respect and listening" },
      { key: "warm-up-stretching", label: "Warm-up & Stretching", hint: "Participation, consistency and preparation" },
    ],
  },
  {
    id: "overall",
    title: "Overall Assessment",
    skills: [
      { key: "overall-improvement", label: "Overall Improvement", hint: "Progress compared to the previous assessment" },
    ],
  },
]

export const ASSESSMENT_SKILLS: readonly AssessmentSkill[] = ASSESSMENT_SECTIONS.flatMap(
  (section) => section.skills,
)

export const ASSESSMENT_SKILL_COUNT = ASSESSMENT_SKILLS.length

const SKILL_KEYS: ReadonlySet<string> = new Set(ASSESSMENT_SKILLS.map((skill) => skill.key))

/** Skill key to a whole rating from 1 to 5. A skill the coach has not rated has no entry. */
export type AssessmentRatings = Readonly<Record<string, number>>

export function isAssessmentRating(value: unknown): value is number {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= ASSESSMENT_RATING_MIN
    && value <= ASSESSMENT_RATING_MAX
}

/**
 * Strict: for what a coach submits. Returns the cleaned ratings, or the reason
 * the input is not acceptable, so a tampered request is refused rather than
 * quietly trimmed into something the coach never sent.
 */
export function validateAssessmentRatings(
  input: unknown,
): { ok: true; ratings: AssessmentRatings } | { ok: false; message: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, message: "The ratings could not be read." }
  }
  const ratings: Record<string, number> = {}
  for (const [key, value] of Object.entries(input)) {
    if (!SKILL_KEYS.has(key)) {
      return { ok: false, message: "One of the rated skills is not recognised." }
    }
    if (!isAssessmentRating(value)) {
      return { ok: false, message: "Each rating must be a whole number from 1 to 5." }
    }
    ratings[key] = value
  }
  return { ok: true, ratings }
}

/**
 * Tolerant: for what is already stored. A row written by an earlier version of
 * the rubric still loads; entries this version does not know are dropped from
 * the display rather than failing the page.
 */
export function parseStoredRatings(stored: string | null | undefined): AssessmentRatings {
  if (!stored) return {}
  try {
    const parsed: unknown = JSON.parse(stored)
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {}
    const ratings: Record<string, number> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (SKILL_KEYS.has(key) && isAssessmentRating(value)) ratings[key] = value
    }
    return ratings
  } catch {
    return {}
  }
}

export function countRated(ratings: AssessmentRatings) {
  return ASSESSMENT_SKILLS.filter((skill) => isAssessmentRating(ratings[skill.key])).length
}

function average(values: readonly number[]) {
  if (values.length === 0) return null
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  return Math.round(mean * 10) / 10
}

/** The "/ 5.0" on the template: the mean of every skill the coach rated, to one decimal. */
export function overallRating(ratings: AssessmentRatings) {
  return average(
    ASSESSMENT_SKILLS.flatMap((skill) => {
      const value = ratings[skill.key]
      return isAssessmentRating(value) ? [value] : []
    }),
  )
}

export function sectionRating(section: AssessmentSection, ratings: AssessmentRatings) {
  return average(
    section.skills.flatMap((skill) => {
      const value = ratings[skill.key]
      return isAssessmentRating(value) ? [value] : []
    }),
  )
}

export function formatRating(value: number | null) {
  return value === null ? "–" : value.toFixed(1)
}

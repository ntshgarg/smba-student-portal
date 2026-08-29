import path from "node:path"

// Every dated row a fixture build writes is derived from this date, so the
// accessibility gate has to render the result at a matching instant or the
// audited DOM changes on its own every midnight. That instant is
// SMBA_ACCESSIBILITY_CLOCK in .github/workflows/ui-accessibility.yml, and it is
// deliberately a fortnight later than this anchor rather than equal to it —
// moving this date means moving that one, and re-checking the bounds recorded
// beside it.
export const FIXTURE_ANCHOR_DATE = "2026-08-03"
export const FIXTURE_SCHEDULE_START = "2026-07-01"
export const FIXTURE_SCHEDULE_END = "2026-09-30"

export type FixtureProfileName = "demo" | "edge" | "stress"
export type TrainingLevel = "Beginner" | "Intermediate" | "Advanced" | "Adult" | "Elite"
export type TrainingBatch = "Weekday" | "Weekend"
export type AcademyPlan =
  | "weekday-3-day"
  | "weekday-4-day"
  | "weekday-5-day"
  | "weekend-standard"
export type FixtureEnrollmentState = "active" | "paused" | "unassigned" | "archived"

export type PlayerDefinition = {
  academyPlan: AcademyPlan
  batch: TrainingBatch
  finalState: FixtureEnrollmentState
  fullName: string
  index: number
  level: TrainingLevel
  planOrdinal: number
  slotVariant: number
}

export type FixtureProfile = {
  approvedPlayerCount: number
  description: string
  juniorCoaches: ReadonlyArray<{
    attendanceRate: 0.75 | 1
    fullName: string
  }>
  key: FixtureProfileName
  pendingPlayerNames: readonly string[]
  reportMix: {
    drafts: number
    published: number
    revisionDrafts: number
  }
  target: string
}

const projectDataDirectory = path.resolve(process.cwd(), ".data")

export const fixtureProfiles: Record<FixtureProfileName, FixtureProfile> = {
  demo: {
    approvedPlayerCount: 40,
    description: "Canonical academy for daily development and demonstrations",
    juniorCoaches: [
      { attendanceRate: 1, fullName: "Arun Kumar" },
      { attendanceRate: 0.75, fullName: "Meera Nair" },
    ],
    key: "demo",
    pendingPlayerNames: ["Rohan Kulkarni", "Saanvi Reddy"],
    reportMix: { drafts: 10, published: 8, revisionDrafts: 4 },
    target: path.join(projectDataDirectory, "academy-demo.db"),
  },
  edge: {
    approvedPlayerCount: 32,
    description: "Small academy containing supported happy and exceptional paths",
    juniorCoaches: [
      { attendanceRate: 1, fullName: "Arun Kumar" },
      { attendanceRate: 0.75, fullName: "Meera Nair" },
    ],
    key: "edge",
    pendingPlayerNames: ["Rohan Kulkarni", "Saanvi Reddy", "Kabir Joshi"],
    reportMix: { drafts: 10, published: 6, revisionDrafts: 3 },
    target: path.join(projectDataDirectory, "academy-edgecases.db"),
  },
  stress: {
    approvedPlayerCount: 100,
    description: "Scale academy with representative supported workflow variation",
    juniorCoaches: [
      { attendanceRate: 1, fullName: "Arun Kumar" },
      { attendanceRate: 0.75, fullName: "Meera Nair" },
    ],
    key: "stress",
    pendingPlayerNames: ["Rohan Kulkarni", "Saanvi Reddy", "Kabir Joshi"],
    reportMix: { drafts: 50, published: 30, revisionDrafts: 10 },
    target: path.join(projectDataDirectory, "academy-stress.db"),
  },
}

const firstNames = [
  "Aarav", "Aditi", "Advait", "Ananya", "Arjun",
  "Diya", "Ishaan", "Kavya", "Meera", "Vihaan",
]
const lastNames = [
  "Bhat", "Desai", "Gupta", "Iyer", "Kapoor",
  "Menon", "Nair", "Patel", "Rao", "Sharma",
]

function generatedNames(count: number) {
  const names = firstNames.flatMap((firstName) => (
    lastNames.map((lastName) => `${firstName} ${lastName}`)
  )).slice(0, count)
  if (count >= 4) {
    names[count - 4] = "Aarav Srinivasa Venkata Narasimha Rao"
    names[count - 3] = "Diya Lakshmi Subramanian Krishnamurthy"
    names[count - 2] = "Aditi Rao"
    names[count - 1] = "Aditi Rao"
  }
  return names
}

function planFor(level: TrainingLevel, ordinal: number): AcademyPlan {
  // Competitive levels train five weekdays; mirrors academyPlansFor.
  if (level === "Advanced" || level === "Elite") return "weekday-5-day"
  return (["weekday-3-day", "weekday-4-day", "weekday-5-day"] as const)[ordinal % 3]
}

function finalState(profile: FixtureProfileName, index: number, total: number): FixtureEnrollmentState {
  if (profile === "stress") {
    if (index === 96) return "archived"
    if ([24, 70].includes(index)) return "unassigned"
    if ([2, 34, 78].includes(index)) return "paused"
    return "active"
  }
  const exceptionalIndexes = total === 40 ? {
    archived: 38,
    paused: [2, 12, 27],
    unassigned: [18, 33],
  } : {
    archived: 30,
    paused: [2, 10, 22],
    unassigned: [14, 26],
  }
  if (index === exceptionalIndexes.archived) return "archived"
  if (exceptionalIndexes.unassigned.includes(index)) return "unassigned"
  if (exceptionalIndexes.paused.includes(index)) return "paused"
  return "active"
}

export function createPlayerDefinitions(profile: FixtureProfile): PlayerDefinition[] {
  const names = generatedNames(profile.approvedPlayerCount)
  const groups: Array<{ batch: TrainingBatch; count: number; level: TrainingLevel }> = profile.key === "stress"
    ? [
      { level: "Beginner", batch: "Weekday", count: 22 },
      { level: "Beginner", batch: "Weekend", count: 8 },
      { level: "Intermediate", batch: "Weekday", count: 18 },
      { level: "Intermediate", batch: "Weekend", count: 8 },
      { level: "Advanced", batch: "Weekday", count: 12 },
      // Was Advanced/Weekend, which the academy no longer offers. Six Elite
      // players keep the total at 100 and the cohort count at eight, and give the
      // fee-less level real coverage in the fixtures.
      { level: "Elite", batch: "Weekday", count: 6 },
      { level: "Adult", batch: "Weekday", count: 18 },
      { level: "Adult", batch: "Weekend", count: 8 },
    ]
    /*
     * Written out rather than crossed, because Advanced and Elite are weekday
     * only. Still eight cohorts, so the per-cohort divisor is unchanged.
     */
    : ([
      { batch: "Weekday", level: "Beginner" },
      { batch: "Weekend", level: "Beginner" },
      { batch: "Weekday", level: "Intermediate" },
      { batch: "Weekend", level: "Intermediate" },
      { batch: "Weekday", level: "Advanced" },
      { batch: "Weekday", level: "Elite" },
      { batch: "Weekday", level: "Adult" },
      { batch: "Weekend", level: "Adult" },
    ] as Array<{ batch: TrainingBatch; level: TrainingLevel }>)
      .map(({ batch, level }) => ({ batch, count: profile.approvedPlayerCount / 8, level }))

  const players: PlayerDefinition[] = []
  let index = 0
  groups.forEach(({ batch, count, level }) => {
    for (let ordinal = 0; ordinal < count; ordinal += 1) {
      players.push({
        academyPlan: batch === "Weekend" ? "weekend-standard" : planFor(level, ordinal),
        batch,
        finalState: finalState(profile.key, index, profile.approvedPlayerCount),
        fullName: names[index],
        index,
        level,
        planOrdinal: ordinal,
        slotVariant: batch === "Weekday" ? ordinal % 2 : 0,
      })
      index += 1
    }
  })
  if (players.length !== profile.approvedPlayerCount) {
    throw new Error(`${profile.key} generated ${players.length} players instead of ${profile.approvedPlayerCount}.`)
  }
  return players
}

export function resolveFixtureProfile(value: string | undefined): FixtureProfile {
  const key = value ?? "stress"
  if (!(key in fixtureProfiles)) {
    throw new Error(`Unknown fixture profile ${key}. Expected demo, edge, or stress.`)
  }
  return fixtureProfiles[key as FixtureProfileName]
}

export function profileManifestPath(profile: FixtureProfile) {
  return `${profile.target}.manifest.json`
}

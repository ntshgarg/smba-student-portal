import {
  monthlyFeePaise,
  REGISTRATION_FEE_PAISE,
} from "@/lib/finance/config"

const rupees = (paise: number) => paise / 100

/*
 * These names are written out rather than reusing `TrainingProgramme` on purpose.
 * The public site advertises what the academy sells to anyone who asks; the level
 * list is what the academy records internally, and Elite belongs only to the
 * second. Importing the union would make every future level appear here by
 * default, which is the wrong default for a price list.
 */
export type WeekdayProgram = {
  name: "Beginner" | "Intermediate" | "Advanced" | "Adult"
  duration: string
  fees: Partial<Record<3 | 4 | 5, number>>
}

export type WeekendProgram = {
  name: "Beginner" | "Intermediate" | "Advanced" | "Adult"
  duration: string
  fee: number
}

export const contact = {
  phoneDisplay: "+91 70109 28404",
  phone: "+917010928404",
  whatsapp: "https://wa.me/917010928404",
  venue: "Just Play, Mahadevapura",
  maps:
    "https://www.google.com/maps/search/?api=1&query=Just+Play+Mahadevapura+Bengaluru",
  academyInstagram: {
    handle: "@smbaacademy",
    url: "https://www.instagram.com/smbaacademy/",
  },
  coachInstagram: {
    handle: "@badmintoncoach_sathiya",
    url: "https://www.instagram.com/badmintoncoach_sathiya/",
  },
} as const

export const weekdayPrograms: WeekdayProgram[] = [
  {
    name: "Beginner",
    duration: "1 hour",
    fees: {
      3: rupees(monthlyFeePaise.Beginner["weekday-3-day"]),
      4: rupees(monthlyFeePaise.Beginner["weekday-4-day"]),
      5: rupees(monthlyFeePaise.Beginner["weekday-5-day"]),
    },
  },
  {
    name: "Intermediate",
    duration: "2 hours",
    fees: {
      3: rupees(monthlyFeePaise.Intermediate["weekday-3-day"]),
      4: rupees(monthlyFeePaise.Intermediate["weekday-4-day"]),
      5: rupees(monthlyFeePaise.Intermediate["weekday-5-day"]),
    },
  },
  {
    name: "Advanced",
    duration: "3 hours",
    fees: { 5: rupees(monthlyFeePaise.Advanced["weekday-5-day"]) },
  },
  {
    name: "Adult",
    duration: "1 hour",
    fees: {
      3: rupees(monthlyFeePaise.Adult["weekday-3-day"]),
      4: rupees(monthlyFeePaise.Adult["weekday-4-day"]),
      5: rupees(monthlyFeePaise.Adult["weekday-5-day"]),
    },
  },
]

// Advanced is weekday-only, so it is absent here rather than priced.
export const weekendPrograms: WeekendProgram[] = [
  { name: "Beginner", duration: "1 hour", fee: rupees(monthlyFeePaise.Beginner["weekend-standard"]) },
  { name: "Intermediate", duration: "1.5 hours", fee: rupees(monthlyFeePaise.Intermediate["weekend-standard"]) },
  { name: "Adult", duration: "1 hour", fee: rupees(monthlyFeePaise.Adult["weekend-standard"]) },
]

export const enrollmentTerms = {
  registrationFee: rupees(REGISTRATION_FEE_PAISE),
  registrationIsNonRefundable: true,
  registrationIncludes: ["a welcome kit", "assessment reports"],
} as const

export const trainingPrograms = [
  {
    title: "Beginner",
    level: "Build the foundation",
    outcomes: ["Grip and stroke basics", "Footwork confidence", "Repeatable technique"],
  },
  {
    title: "Intermediate",
    level: "Develop consistency",
    outcomes: ["Shot consistency", "Movement efficiency", "Structured match practice"],
  },
  {
    title: "Advanced",
    level: "Train for performance",
    outcomes: ["Competitive preparation", "Higher training load", "Performance discipline"],
  },
  {
    title: "Adult",
    level: "Train with purpose",
    outcomes: ["Weekday and weekend options", "Fitness through the game", "Welcoming progression"],
  },
] as const

export type Schedule = "weekday" | "weekend"

/**
 * What a level's plan costs and gives for a schedule and a number of weekday days. A level with no weekend
 * plan (Advanced) falls back to weekdays, and a days count the level doesn't offer falls back to its first.
 */
export function programPlan(level: WeekdayProgram["name"], schedule: Schedule, days: number) {
  const weekday = weekdayPrograms.find((program) => program.name === level)
  if (!weekday) throw new Error(`No weekday plan for ${level}`)
  const weekend = weekendPrograms.find((program) => program.name === level)
  const frequencies = (Object.keys(weekday.fees).map(Number) as (3 | 4 | 5)[])
  const daysAWeek = frequencies.find((frequency) => frequency === days) ?? frequencies[0]
  const onWeekend = schedule === "weekend" && weekend !== undefined
  return {
    hasWeekend: weekend !== undefined,
    onWeekend,
    frequencies,
    daysAWeek,
    ...(onWeekend
      ? { fee: weekend.fee, sessions: 2, duration: weekend.duration }
      : { fee: weekday.fees[daysAWeek] as number, sessions: daysAWeek, duration: weekday.duration }),
  }
}

export function createTrialMessage(values: {
  name: string
  level: string
  schedule: string
  callback: boolean
  note: string
}) {
  const lines = [
    "Hello SMBA, I would like to book a free trial.",
    "",
    `Name: ${values.name.trim() || "Not provided"}`,
    `Current level: ${values.level}`,
    `Preferred schedule: ${values.schedule}`,
    `Callback requested: ${values.callback ? "Yes" : "No"}`,
  ]

  if (values.note.trim()) {
    lines.push(`Note: ${values.note.trim()}`)
  }

  return `${contact.whatsapp}?text=${encodeURIComponent(lines.join("\n"))}`
}

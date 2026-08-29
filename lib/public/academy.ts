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
  location: "Just Play, Mahadevapura, Bengaluru",
  maps:
    "https://www.google.com/maps/search/?api=1&query=Just+Play+Mahadevapura+Bengaluru",
  academyInstagram: {
    handle: "@sathiyamoorthybadmintonacademy",
    url: "https://www.instagram.com/sathiyamoorthybadmintonacademy/",
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
    step: "01",
    title: "Beginner",
    level: "Build the foundation",
    description:
      "Build sound fundamentals, confident movement and a technical base that can grow with you.",
    outcomes: ["Grip and stroke basics", "Footwork confidence", "Repeatable technique"],
  },
  {
    step: "02",
    title: "Intermediate",
    level: "Develop consistency",
    description:
      "Turn the basics into consistency, movement efficiency and a stronger capacity to train.",
    outcomes: ["Shot consistency", "Movement efficiency", "Structured match practice"],
  },
  {
    step: "03",
    title: "Advanced",
    level: "Train for performance",
    description:
      "Train with greater frequency and a sharper technical, physical and competitive focus.",
    outcomes: ["Competitive preparation", "Higher training load", "Performance discipline"],
  },
  {
    step: "04",
    title: "Adult",
    level: "Train with purpose",
    description:
      "Purposeful coaching for adults who want skill, movement and a better way to train.",
    outcomes: ["Weekday and weekend options", "Fitness through the game", "Welcoming progression"],
  },
] as const

export const proofPoints = [
  {
    label: "BWF certified",
    title: "Coaching with a recognised foundation.",
    body: "Head coach Sathiya Moorthy brings formal coaching credentials to every stage of player development.",
  },
  {
    label: "12+ years",
    title: "Experience that stays close to the work.",
    body: "More than a decade of coaching informs how sessions are structured, observed and progressed.",
  },
  {
    label: "Player development",
    title: "From first contact to competitive intent.",
    body: "Experience developing players across international, national and state-level competition.",
  },
  {
    label: "Complete preparation",
    title: "Technique is only part of performance.",
    body: "Training brings together match practice, competitive mentality, strength and conditioning.",
  },
  {
    label: "Move well",
    title: "A body prepared for better badminton.",
    body: "Mobility and flexibility are integrated into the training approach, not treated as an afterthought.",
  },
  {
    label: "Train with clarity",
    title: "Professional courts. Structured feedback.",
    body: "Sessions take place at Just Play, with assessment reports included in the academy registration.",
  },
] as const

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

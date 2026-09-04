/*
 * Builds a local walkthrough academy: the head coach, a full term of recurring
 * schedules, and a queue of registration requests waiting for approval. Nothing
 * else -- no players on the books, no assistant coaches, no fees, no attendance.
 *
 * It exists so the onboarding flow can be driven by hand from the very first
 * screen. Every other fixture either starts empty (nothing to assign a player
 * to) or starts full (nothing left to onboard).
 *
 * Local files only. The guard below refuses a remote target outright rather than
 * trusting the caller to have pointed it somewhere safe.
 */
import Database from "better-sqlite3"
import { randomUUID } from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"

import { normalizedNameKey, normalizeFullName } from "@/lib/auth/identity"
import { registrationSubjectKey } from "@/lib/auth/recovery-service"
import * as schema from "@/lib/db/schema"
import { createSessionSeriesRecords } from "@/lib/sessions/service"

const HEAD_COACH_ID = "00000000-0000-4000-8000-000000000001"
const SOURCE = ".data/academy-clean.db"
const TARGET = process.env.SMBA_WALKTHROUGH_DB ?? ".data/academy-walkthrough.db"
const VENUE = "SMBA Court"

/*
 * Anchored, not `new Date()`. A fixture whose schedules drift relative to today
 * stops exercising the same cases a week later -- and the onboarding flow keys
 * hard off whether a series has started, so "already running" versus "starts
 * next month" has to stay fixed on purpose rather than by luck.
 */
const TERM_STARTS_ON = "2026-07-01"
const TERM_ENDS_ON = "2027-03-31"
const NEXT_TERM_STARTS_ON = "2026-10-01"
const NOW = new Date("2026-09-04T09:00:00.000+05:30")

const WEEKDAYS = [1, 2, 3, 4, 5]
const WEEKEND = [0, 6]

/**
 * One row per recurring schedule. Times are kept inside the three windows the
 * academy actually runs -- 06:00-08:00, 11:00-13:00 and 16:00-19:00 on weekdays,
 * 07:00-11:00 at the weekend -- and no two schedules of the same programme and
 * batch overlap, which `createSessionSeriesRecords` refuses anyway.
 *
 * Advanced and Elite are deliberately weekday-only: `academyPlansFor` returns no
 * plan for either at the weekend, so a weekend series for them could never take
 * a player (lib/training/academy-plans.ts).
 */
const SCHEDULES: Array<{
  batch: "Weekday" | "Weekend"
  durationMinutes: number
  note: string
  programme: "Beginner" | "Intermediate" | "Advanced" | "Adult" | "Elite"
  startTime: string
  startsOn?: string
  weekdays: number[]
}> = [
  // Early weekday window, 06:00-08:00 -- the competitive levels, before school.
  { batch: "Weekday", durationMinutes: 90, note: "Elite squad", programme: "Elite", startTime: "06:00", weekdays: WEEKDAYS },
  { batch: "Weekday", durationMinutes: 90, note: "Advanced squad", programme: "Advanced", startTime: "06:30", weekdays: WEEKDAYS },

  // Late morning, 11:00-13:00 -- adults, while the courts are otherwise idle.
  { batch: "Weekday", durationMinutes: 60, note: "Adult late morning", programme: "Adult", startTime: "11:00", weekdays: WEEKDAYS },
  { batch: "Weekday", durationMinutes: 60, note: "Adult midday", programme: "Adult", startTime: "12:00", weekdays: WEEKDAYS },

  // Evening, 16:00-19:00 -- the school-age bulk of the academy.
  { batch: "Weekday", durationMinutes: 90, note: "Intermediate early evening", programme: "Intermediate", startTime: "16:00", weekdays: WEEKDAYS },
  { batch: "Weekday", durationMinutes: 60, note: "Beginner early evening", programme: "Beginner", startTime: "16:00", weekdays: WEEKDAYS },
  { batch: "Weekday", durationMinutes: 60, note: "Beginner evening", programme: "Beginner", startTime: "17:00", weekdays: WEEKDAYS },
  { batch: "Weekday", durationMinutes: 120, note: "Advanced evening", programme: "Advanced", startTime: "17:00", weekdays: WEEKDAYS },
  { batch: "Weekday", durationMinutes: 90, note: "Intermediate late evening", programme: "Intermediate", startTime: "17:30", weekdays: WEEKDAYS },
  { batch: "Weekday", durationMinutes: 60, note: "Beginner late evening", programme: "Beginner", startTime: "18:00", weekdays: WEEKDAYS },

  // Weekend, 07:00-11:00. No Advanced or Elite: they have no weekend plan.
  { batch: "Weekend", durationMinutes: 90, note: "Beginner weekend morning", programme: "Beginner", startTime: "07:00", weekdays: WEEKEND },
  { batch: "Weekend", durationMinutes: 90, note: "Intermediate weekend morning", programme: "Intermediate", startTime: "07:30", weekdays: WEEKEND },
  { batch: "Weekend", durationMinutes: 90, note: "Beginner weekend late morning", programme: "Beginner", startTime: "09:00", weekdays: WEEKEND },
  { batch: "Weekend", durationMinutes: 90, note: "Adult weekend", programme: "Adult", startTime: "09:30", weekdays: WEEKEND },

  /*
   * One schedule that has not started yet. Onboarding a player onto this is the
   * case where the training start date is necessarily in the future, which the
   * Fee Plan step defers rather than refuses (lib/finance/service.ts:972).
   */
  { batch: "Weekday", durationMinutes: 60, note: "New beginner batch (starts 1 Oct)", programme: "Beginner", startTime: "19:00", startsOn: NEXT_TERM_STARTS_ON, weekdays: WEEKDAYS },
]

/**
 * The approval queue. Ages are spread on purpose: the Adult programme needs
 * adults, and the competitive levels read oddly on a seven-year-old, so a coach
 * walking the queue has a real assessment decision to make each time rather than
 * the same one twelve times.
 */
const REQUESTS: Array<{ dateOfBirth: string; email: string; fullName: string; phone: string }> = [
  { dateOfBirth: "2014-03-12", email: "meera.krishnan@example.in", fullName: "Aditya Krishnan", phone: "+91 98450 11201" },
  { dateOfBirth: "2012-07-28", email: "s.venkatesh@example.in", fullName: "Nandini Venkatesh", phone: "+91 98450 11202" },
  { dateOfBirth: "2016-01-05", email: "rahul.menon@example.in", fullName: "Kabir Menon", phone: "+91 98450 11203" },
  { dateOfBirth: "2010-11-19", email: "deepa.rao@example.in", fullName: "Ishita Rao", phone: "+91 98450 11204" },
  { dateOfBirth: "2009-05-02", email: "prakash.iyer@example.in", fullName: "Rohan Iyer", phone: "+91 98450 11205" },
  { dateOfBirth: "2015-09-23", email: "lakshmi.pillai@example.in", fullName: "Anaya Pillai", phone: "+91 98450 11206" },
  { dateOfBirth: "2013-02-14", email: "ganesh.shetty@example.in", fullName: "Vihaan Shetty", phone: "+91 98450 11207" },
  { dateOfBirth: "2011-06-30", email: "sunita.desai@example.in", fullName: "Saanvi Desai", phone: "+91 98450 11208" },
  { dateOfBirth: "1994-04-17", email: "arun.bhat@example.in", fullName: "Arun Bhat", phone: "+91 98450 11209" },
  { dateOfBirth: "1988-12-08", email: "priya.nayak@example.in", fullName: "Priya Nayak", phone: "+91 98450 11210" },
  { dateOfBirth: "2017-08-11", email: "harish.kamath@example.in", fullName: "Aarav Kamath", phone: "+91 98450 11211" },
  // Two children on one address: the composite identity key has to keep them apart.
  { dateOfBirth: "2015-08-11", email: "harish.kamath@example.in", fullName: "Advika Kamath", phone: "+91 98450 11211" },
]

function refuseRemoteTarget(target: string) {
  if (process.env.TURSO_DATABASE_URL || process.env.SMBA_USE_TURSO === "true") {
    throw new Error(
      "This builder writes a throwaway local academy and must never be pointed at a "
        + "remote database. Unset TURSO_DATABASE_URL and SMBA_USE_TURSO and try again.",
    )
  }
  if (target.startsWith("libsql:") || target.startsWith("http:") || target.startsWith("https:")) {
    throw new Error(`Refusing a remote target: ${target}`)
  }
}

function build() {
  refuseRemoteTarget(TARGET)

  if (!fs.existsSync(SOURCE)) {
    throw new Error(`${SOURCE} is missing. Run \`npm run fixture:build:clean\` first.`)
  }

  // Start from the clean academy rather than an empty file: it already carries
  // the head coach, their credential and the reference data, and this builder
  // has no business minting any of that a second way.
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${TARGET}${suffix}`, { force: true })
  }
  fs.mkdirSync(path.dirname(TARGET), { recursive: true })
  fs.copyFileSync(SOURCE, TARGET)

  const sqlite = new Database(TARGET)
  sqlite.pragma("foreign_keys = ON")
  const database = drizzle(sqlite, { schema })
  migrate(database, { migrationsFolder: path.resolve(process.cwd(), "drizzle") })

  for (const schedule of SCHEDULES) {
    createSessionSeriesRecords({
      coachId: HEAD_COACH_ID,
      database: database as never,
      input: {
        batch: schedule.batch,
        durationMinutes: schedule.durationMinutes,
        endsOn: TERM_ENDS_ON,
        programme: schedule.programme,
        startTime: schedule.startTime,
        startsOn: schedule.startsOn ?? TERM_STARTS_ON,
        venue: VENUE,
        weekdays: schedule.weekdays,
      },
      now: NOW,
    })
  }

  const insertRequest = sqlite.prepare(`
    insert into accounts (
      id, full_name, normalized_name, registration_identity_key,
      contact_email, contact_phone, date_of_birth,
      requested_role, approval_status, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, 'player', 'pending', ?, ?)
  `)

  REQUESTS.forEach((request, index) => {
    const fullName = normalizeFullName(request.fullName)
    const normalizedName = normalizedNameKey(fullName)
    const email = request.email.trim().toLowerCase()
    // Staggered so the queue has a believable order rather than twelve rows
    // sharing one timestamp and sorting arbitrarily.
    const requestedAt = NOW.getTime() - (REQUESTS.length - index) * 3_600_000
    insertRequest.run(
      randomUUID(),
      fullName,
      normalizedName,
      registrationSubjectKey(email, normalizedName),
      email,
      request.phone,
      request.dateOfBirth,
      requestedAt,
      requestedAt,
    )
  })

  const count = (table: string) =>
    (sqlite.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n
  const integrity = sqlite.pragma("integrity_check", { simple: true })
  const foreignKeys = sqlite.pragma("foreign_key_check")
  const summary = {
    attendance: count("session_attendance_records"),
    charges: count("financial_charges"),
    enrollments: count("player_enrollments"),
    occurrences: count("session_occurrences"),
    pending: count("accounts") - 1,
    series: count("session_series"),
  }
  sqlite.close()

  if (integrity !== "ok") throw new Error(`Integrity check failed: ${String(integrity)}`)
  if (Array.isArray(foreignKeys) && foreignKeys.length) {
    throw new Error(`Foreign key check failed: ${JSON.stringify(foreignKeys)}`)
  }

  console.log(`Built ${TARGET}`)
  console.log(`  schedules:            ${summary.series}`)
  console.log(`  scheduled sessions:   ${summary.occurrences}`)
  console.log(`  awaiting approval:    ${summary.pending}`)
  console.log(`  players on the books: ${summary.enrollments}`)
  console.log(`  fees / attendance:    ${summary.charges} / ${summary.attendance}`)
  console.log("")
  console.log("  Head coach: SMBA-HC-0001")
}

build()

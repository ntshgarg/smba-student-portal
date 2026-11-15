import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { placeReachesWindow } from "@/lib/sessions/term"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-place-coverage-test-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "smba-place-coverage.db")

/*
 * "Which days does a schedule place cover?" was written out in several places,
 * and one of them counted a place closed on its own first day as covering the
 * days after it. One rule now, in two forms: code (placeReachesWindow) and a
 * query condition (placeReachesWindowCondition). These prove the two forms
 * agree on every case, with and without the schedule's own dates.
 */
const schedules = {
  // The whole season.
  season: { startsOn: "2026-07-01", endsOn: "2027-03-31" },
  // A term that ran out in September.
  autumn: { startsOn: "2026-07-01", endsOn: "2026-09-30" },
  // A schedule that starts in the new year.
  spring: { startsOn: "2027-01-01", endsOn: "2027-06-30" },
} as const

const places = [
  { id: "open", schedule: "season", effectiveFrom: "2026-07-01", effectiveTo: null },
  { id: "closed-november", schedule: "season", effectiveFrom: "2026-07-01", effectiveTo: "2026-11-01" },
  // Left before the schedule started: closed on its own first day.
  { id: "never-started", schedule: "spring", effectiveFrom: "2027-01-01", effectiveTo: "2027-01-01" },
  { id: "spring-open", schedule: "spring", effectiveFrom: "2027-01-01", effectiveTo: null },
  { id: "autumn-open", schedule: "autumn", effectiveFrom: "2026-07-01", effectiveTo: null },
  { id: "ends-tomorrow", schedule: "season", effectiveFrom: "2026-10-01", effectiveTo: "2026-12-11" },
] as const

const windows: Array<[string, string | null]> = [
  ["2026-10-01", "2026-11-01"],
  ["2026-11-01", "2026-12-01"],
  ["2026-12-11", null],
  ["2026-12-12", null],
  ["2027-01-01", "2027-02-01"],
  ["2026-06-01", "2026-07-01"],
]

describe("the days a schedule place covers", () => {
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let schema: typeof import("@/lib/db/schema")
  let condition: typeof import("@/lib/sessions/place-coverage")["placeReachesWindowCondition"]
  let repository: typeof import("@/lib/finance/repository")
  const seriesIds = new Map<string, string>()
  const playerId = "place-coverage-player"

  beforeAll(async () => {
    schema = await import("@/lib/db/schema")
    condition = (await import("@/lib/sessions/place-coverage")).placeReachesWindowCondition
    repository = await import("@/lib/finance/repository")
    const { findApprovedAccountByAcademyId } = await import("@/lib/auth/account-service")
    const { createSessionSeriesRecords } = await import("@/lib/sessions/service")
    const { prepareDatabase } = await import("@/lib/db/setup")
    database = prepareDatabase({ seed: true })
    const coachId = findApprovedAccountByAcademyId("SMBA#0001")?.accountId
    if (!coachId) throw new Error("Seed coach was not created.")
    const now = new Date("2026-06-01T05:00:00.000Z")
    for (const [index, [name, dates]] of Object.entries(schedules).entries()) {
      seriesIds.set(name, createSessionSeriesRecords({
        coachId,
        database,
        now,
        input: {
          programme: "Beginner",
          batch: "Weekday",
          venue: "SMBA Court",
          ...dates,
          weekdays: [1, 2, 3, 4, 5],
          startTime: `0${6 + index}:00`,
          durationMinutes: 60,
        },
      }))
    }
    database.insert(schema.accounts).values({
      approvalStatus: "approved",
      approvedAt: now,
      createdAt: now,
      fullName: "Place Rule",
      id: playerId,
      normalizedName: "place rule",
      requestedRole: "player",
      role: "player",
      updatedAt: now,
    }).run()
    for (const place of places) {
      database.insert(schema.sessionAssignments).values({
        accountId: playerId,
        assignedAt: now,
        assignedByAccountId: coachId,
        effectiveFrom: place.effectiveFrom,
        effectiveTo: place.effectiveTo,
        id: place.id,
        seriesId: seriesIds.get(place.schedule)!,
      }).run()
    }
  })

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  describe.each([true, false])("with the schedule's dates: %s", (withSchedule) => {
    it.each(windows)("agrees with the code from %s up to %s", (from, toExclusive) => {
      const fromQuery = database.select({ id: schema.sessionAssignments.id }).from(schema.sessionAssignments)
        .innerJoin(schema.sessionSeries, eq(schema.sessionSeries.id, schema.sessionAssignments.seriesId))
        .where(and(
          eq(schema.sessionAssignments.accountId, playerId),
          condition(from, toExclusive, { schedule: withSchedule }),
        ))
        .all().map((row) => row.id).sort()
      const fromCode = places.filter((place) => placeReachesWindow(
        place,
        withSchedule ? schedules[place.schedule] : null,
        from,
        toExclusive,
      )).map((place) => place.id).sort()
      expect(fromQuery).toEqual(fromCode)
    })
  })

  it("never counts a place closed on its own first day", () => {
    const never = places.find((place) => place.id === "never-started")!
    expect(windows.some(([from, toExclusive]) => (
      placeReachesWindow(never, schedules.spring, from, toExclusive)
    ))).toBe(false)
  })

  it("lets a withdrawal refund through for a player who left before a later schedule started", () => {
    const leaver = "place-coverage-leaver"
    const at = new Date("2026-12-10T05:00:00.000Z")
    database.insert(schema.accounts).values({
      approvalStatus: "approved",
      approvedAt: at,
      createdAt: at,
      fullName: "Early Leaver",
      id: leaver,
      normalizedName: "early leaver",
      requestedRole: "player",
      role: "player",
      updatedAt: at,
    }).run()
    const coachId = database.select().from(schema.sessionAssignments).get()!.assignedByAccountId
    const place = (id: string, effectiveFrom: string, effectiveTo: string | null, schedule: string) => {
      database.insert(schema.sessionAssignments).values({
        accountId: leaver,
        assignedAt: at,
        assignedByAccountId: coachId,
        effectiveFrom,
        effectiveTo,
        id,
        seriesId: seriesIds.get(schedule)!,
      }).run()
    }
    // Trained this term up to today, and was booked onto January's schedule;
    // "They have left already" closed both.
    place("leaver-season", "2026-07-01", "2026-12-11", "season")
    place("leaver-spring", "2027-01-01", "2027-01-01", "spring")
    expect(repository.playerTrainingHasEnded(database, leaver, "2026-12-10")).toBe(true)

    // A place that still runs after today keeps them in training.
    database.update(schema.sessionAssignments).set({ effectiveTo: null })
      .where(eq(schema.sessionAssignments.id, "leaver-spring")).run()
    expect(repository.playerTrainingHasEnded(database, leaver, "2026-12-10")).toBe(false)
  })
})

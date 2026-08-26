import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { afterAll, afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { buildJuniorCoachAttendanceCalendar } from "@/components/coach/junior-coach-attendance-calendar"
import { listActivePlayerAnnouncements } from "@/lib/announcements/queries"
import { publishAnnouncement } from "@/lib/announcements/service"
import { createAuthMailer } from "@/lib/auth/mailer"
import { academyCurrentMonth, academyNow, academyToday } from "@/lib/clock"
import type { SmbaDatabase } from "@/lib/db/client"
import * as schema from "@/lib/db/schema"
import { INITIAL_COACH_ACCOUNT_ID, seedDatabase } from "@/lib/db/seed"

// The gate serves its fixture from a copy under the OS temp root, and the pin is
// refused anywhere else, so the guard has to be satisfied with a real path.
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-accessibility-clock-"))
const gateDatabasePath = path.join(temporaryDirectory, "smba-accessibility-stress.db")
const PINNED_INSTANT = "2026-08-17T09:30:00+05:30"

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

afterAll(() => {
  fs.rmSync(temporaryDirectory, { force: true, recursive: true })
})

function stubGateEnvironment(clock: string | undefined = PINNED_INSTANT) {
  vi.stubEnv("VERCEL", "")
  vi.stubEnv("TMPDIR", temporaryDirectory)
  vi.stubEnv("DB_FILE_NAME", gateDatabasePath)
  vi.stubEnv("SMBA_ACCESSIBILITY_PROFILE", "stress")
  vi.stubEnv("SMBA_ACCESSIBILITY_CLOCK", clock ?? "")
}

function atWallClock(instant: string) {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(instant))
}

// Shaped like the stress fixture's junior-coach ledger: scripts/regression/fixture.ts
// seeds exactly 20 staff-attendance days ending at FIXTURE_ANCHOR_DATE, so nothing
// after 2026-08-03 is ever recorded no matter how long ago the fixture was built.
const recordedLedgerDays = Array.from({ length: 20 }, (_, index) => {
  const cursor = new Date("2026-08-03T00:00:00.000Z")
  cursor.setUTCDate(cursor.getUTCDate() - (19 - index))
  return {
    choice: index % 4 === 3 ? "absent" as const : "present" as const,
    dateKey: cursor.toISOString().slice(0, 10),
  }
})

/** The audited `junior-coach-personal-attendance` grid, rendered at whatever the server calls today. */
function auditedAugustLedger() {
  const referenceDate = academyToday()
  const referenceYear = Number(referenceDate.slice(0, 4))
  return buildJuniorCoachAttendanceCalendar(
    {
      joinedOn: "2026-07-01",
      records: recordedLedgerDays,
      referenceDate,
      years: [referenceYear - 1, referenceYear, referenceYear + 1],
    },
    2026,
    8,
  ).days.map((day) => day.state)
}

function tally(states: string[]) {
  return states.reduce<Record<string, number>>((counts, state) => {
    counts[state] = (counts[state] ?? 0) + 1
    return counts
  }, {})
}

describe("the accessibility gate's frozen fixture against a moving clock", () => {
  it("moves one ledger cell out of the future for every day that passes", () => {
    // This is the defect, measured rather than described: `stress ·
    // color-contrast` was re-recorded 1015 -> 1021 by 58460e6, a commit that
    // changed no CSS at all, one academy midnight after the 1015 recording --
    // and the two states carrying most of that rule are attendance grids whose
    // cells change colour on this schedule alone. It also pins the unpinned path
    // in place: production still reads the wall clock, and this test fails if
    // that ever stops being true.
    atWallClock("2026-08-25T04:00:00.000Z")
    const onTheTwentyFifth = tally(auditedAugustLedger())

    atWallClock("2026-08-26T04:00:00.000Z")
    const onTheTwentySixth = tally(auditedAugustLedger())

    expect(onTheTwentyFifth.unavailable - onTheTwentySixth.unavailable).toBe(1)
    expect(onTheTwentySixth.unmarked - onTheTwentyFifth.unmarked).toBe(1)
  })

  it("renders the same grid on any day once the gate clock is pinned", () => {
    stubGateEnvironment()

    atWallClock("2026-08-25T04:00:00.000Z")
    const duringTheAuditedMonth = auditedAugustLedger()

    atWallClock("2027-01-09T22:15:00.000Z")
    const nearlyFiveMonthsLater = auditedAugustLedger()

    expect(nearlyFiveMonthsLater).toEqual(duringTheAuditedMonth)
    expect(academyToday()).toBe("2026-08-17")
    expect(academyCurrentMonth()).toBe("2026-08")
  })

  it("keeps every ledger state in the audited grid, which the anchor itself would not", () => {
    // A pin at FIXTURE_ANCHOR_DATE would be self-consistent and would still stop
    // the drift, but the fixture records attendance on every day up to that date,
    // so the August grid would hold no "not recorded" cell at all and the gate
    // would stop watching that colour. The chosen instant sits a fortnight later
    // for exactly this reason.
    stubGateEnvironment()
    atWallClock("2026-08-25T04:00:00.000Z")
    expect(Object.keys(tally(auditedAugustLedger())).sort()).toEqual([
      "absent", "present", "unavailable", "unmarked",
    ])

    stubGateEnvironment("2026-08-03T09:30:00+05:30")
    expect(tally(auditedAugustLedger()).unmarked).toBeUndefined()
  })
})

describe("the pinned instant reaches the read models a page renders from", () => {
  it("decides announcement expiry and the New badge from the pin, not the wall clock", async () => {
    const sqlite = new Database(":memory:")
    try {
      sqlite.pragma("foreign_keys = ON")
      const database = drizzle(sqlite, { schema }) as SmbaDatabase
      migrate(database, { migrationsFolder: path.resolve(process.cwd(), "drizzle") })
      seedDatabase(database)
      const playerId = "10000000-0000-4000-8000-000000000001"
      const publishedAt = new Date("2026-08-15T10:00:00+05:30")
      database.insert(schema.accounts).values({
        id: playerId,
        fullName: "Ledger Player",
        normalizedName: "ledger player",
        requestedRole: "player",
        role: "player",
        approvalStatus: "approved",
        approvedAt: publishedAt,
        createdAt: publishedAt,
        updatedAt: publishedAt,
      }).run()
      database.insert(schema.academyIdAllocations)
        .values({ accountId: playerId, createdAt: publishedAt, serial: 20 })
        .run()
      await publishAnnouncement({
        channels: ["player_dashboard"],
        content: "Courts 3 and 4 are resurfaced.",
        expiresOn: "2026-08-20",
        pinned: false,
        publicationKey: "11111111-1111-4111-8111-111111111111",
        title: "Court resurfacing",
      }, { coachId: INITIAL_COACH_ACCOUNT_ID, database, now: publishedAt })

      // Deliberately no `now`: the point is that the default parameter of a read
      // model a server component calls without one lands on the pinned instant.
      stubGateEnvironment()
      atWallClock("2026-09-30T04:00:00.000Z")
      expect(listActivePlayerAnnouncements(playerId, { database })).toMatchObject([
        { isNew: true, title: "Court resurfacing" },
      ])

      vi.stubEnv("SMBA_ACCESSIBILITY_CLOCK", "")
      expect(listActivePlayerAnnouncements(playerId, { database })).toEqual([])
    } finally {
      sqlite.close()
    }
  })
})

describe("the pin outside the gate", () => {
  it("reads the wall clock when nothing is configured", () => {
    atWallClock("2026-08-26T04:00:00.000Z")
    expect(academyNow().toISOString()).toBe("2026-08-26T04:00:00.000Z")
    expect(academyToday()).toBe("2026-08-26")
  })

  it.each([
    ["a Vercel deployment", () => vi.stubEnv("VERCEL", "1"), /never be set on a Vercel deployment/u],
    ["no gate profile", () => vi.stubEnv("SMBA_ACCESSIBILITY_PROFILE", ""), /SMBA_ACCESSIBILITY_PROFILE/u],
    ["an unknown profile", () => vi.stubEnv("SMBA_ACCESSIBILITY_PROFILE", "production"), /SMBA_ACCESSIBILITY_PROFILE/u],
    ["a database outside the temp root", () => vi.stubEnv("DB_FILE_NAME", "/srv/smba-accessibility.db"), /DB_FILE_NAME/u],
    ["the academy's own database", () => vi.stubEnv("DB_FILE_NAME", path.join(temporaryDirectory, "academy.db")), /DB_FILE_NAME/u],
    ["an instant nobody can parse", () => vi.stubEnv("SMBA_ACCESSIBILITY_CLOCK", "yesterday"), /not a parsable instant/u],
  ])("refuses to render rather than freeze today for %s", (_case, breakIt, message) => {
    // Falling back to the wall clock here would be the worse failure in both
    // directions: silently in the gate, where the drift would resume unnoticed,
    // and invisibly in a deployment, where a frozen "today" on the attendance
    // register is the one thing this product cannot get wrong.
    stubGateEnvironment()
    breakIt()
    expect(() => academyNow()).toThrow(message)
  })
})

describe("the escape-hatch conditions the pin shares with the memory mail transport", () => {
  // Both hatches turn a production build into the accessibility gate, and both
  // used to spell out the same profile and disposable-database checks in full,
  // verbatim, under a comment asking the next reader to keep them in step. They
  // are one predicate now (`lib/accessibility-gate.ts`), and this is what says
  // so in behaviour rather than in a comment: for each database, what the mail
  // transport decides is what the clock decides.
  function mailTransportIsMemory() {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("SMBA_AUTH_MAIL_TRANSPORT", "memory")
    vi.stubEnv("RESEND_API_KEY", "")
    vi.stubEnv("SMBA_AUTH_EMAIL_FROM", "")
    try {
      createAuthMailer()
      return true
    } catch {
      return false
    }
  }

  function clockIsPinned() {
    try {
      academyNow()
      return academyToday() === "2026-08-17"
    } catch {
      return false
    }
  }

  it.each([
    ["a disposable gate database", () => gateDatabasePath, true],
    ["an a11y-named gate database", () => path.join(temporaryDirectory, "smba-a11y-stress.db"), true],
    ["the academy's own database", () => path.join(temporaryDirectory, "academy.db"), false],
    ["a database outside the temporary root", () => "/srv/smba-accessibility-stress.db", false],
  ])("agrees about %s", (_case, databasePath, expected) => {
    stubGateEnvironment()
    vi.stubEnv("DB_FILE_NAME", databasePath())
    expect(clockIsPinned()).toBe(expected)
    expect(mailTransportIsMemory()).toBe(expected)
  })

  it("agrees about an unnamed profile too", () => {
    stubGateEnvironment()
    vi.stubEnv("SMBA_ACCESSIBILITY_PROFILE", "production")
    expect(clockIsPinned()).toBe(false)
    expect(mailTransportIsMemory()).toBe(false)
  })
})

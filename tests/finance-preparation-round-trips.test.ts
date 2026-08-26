import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import BetterSqlite3 from "better-sqlite3"
import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-preparation-round-trips-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "smba-test.db")

/*
 * Preparing a month is the one finance command whose work scales with the whole
 * roster, and all of it runs inside a single `immediate` transaction holding the
 * academy's only write lock while production speaks to libSQL over the network
 * with the synchronous driver. Two writes per charge -- the charge and its audit
 * row -- are deliberate: they carry idempotency keys and audit metadata that a
 * batched write would have to reproduce exactly. Every read is not, and this
 * counts statements rather than reading the source, because the defect it guards
 * against is any per-charge read creeping back into the loop, however spelled.
 */
describe("monthly preparation round trips", () => {
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let finance: typeof import("@/lib/finance/service")
  let schema: typeof import("@/lib/db/schema")
  let domain: typeof import("@/lib/finance/domain")

  const coachId = "00000000-0000-4000-8000-000000000001"
  const now = new Date("2026-08-20T10:00:00+05:30")
  const createdAt = new Date("2026-01-01T10:00:00+05:30")
  const seriesId = "preparation-round-trips-series"
  let nextId = 0
  const createId = () => `preparation-${String(nextId += 1).padStart(5, "0")}`
  let nextSerial = 9_000
  let seriesCreated = false

  const originalPrepare = BetterSqlite3.prototype.prepare

  function countStatements<T>(run: () => T) {
    const statements: string[] = []
    let value: T
    BetterSqlite3.prototype.prepare = function patched(this: BetterSqlite3.Database, ...args) {
      statements.push(String(args[0]))
      return originalPrepare.apply(this, args as Parameters<typeof originalPrepare>)
    } as typeof originalPrepare
    try {
      value = run()
    } finally {
      BetterSqlite3.prototype.prepare = originalPrepare
    }
    return { statements: statements.length, value: value! }
  }

  // The whole gate between a fee agreement and monthly preparation is an active
  // series the player is assigned to; occurrences only matter to proration.
  function enrol(label: string) {
    const playerId = `preparation-player-${label}`
    database.insert(schema.accounts).values({
      id: playerId,
      fullName: `Preparation ${label}`,
      normalizedName: `preparation ${label.toLowerCase()}`,
      requestedRole: "player",
      role: "player",
      approvalStatus: "approved",
      approvedAt: createdAt,
      approvedByAccountId: coachId,
      createdAt,
      updatedAt: createdAt,
    }).run()
    // `readActivePlayer` inner-joins the academy id allocation, so a player
    // without one is invisible to every finance command.
    database.insert(schema.academyIdAllocations).values({
      serial: nextSerial += 1,
      accountId: playerId,
      createdAt,
    }).run()
    database.insert(schema.playerEnrollments).values({
      accountId: playerId,
      academyPlan: "weekday-3-day",
      level: "Beginner",
      batch: "Weekday",
      status: "active",
      trainingStartOn: "2026-01-01",
      updatedAt: createdAt,
    }).run()
    database.insert(schema.feeAgreements).values({
      id: `${playerId}-plan`,
      playerAccountId: playerId,
      academyPlan: "weekday-3-day",
      level: "Beginner",
      batch: "Weekday",
      agreedMonthlyFeePaise: 100_000,
      currency: "INR",
      monthlyDueDay: 5,
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      status: "active",
      recordRevision: 0,
      createdByAccountId: coachId,
      createdAt,
      updatedByAccountId: coachId,
      updatedAt: createdAt,
    }).run()
    if (!seriesCreated) {
      database.insert(schema.sessionSeries).values({
        id: seriesId,
        title: "Beginner_Weekday_preparation",
        programme: "Beginner",
        batch: "Weekday",
        venue: "SMBA Court",
        startsOn: "2026-01-01",
        endsOn: null,
        status: "active",
        createdByAccountId: coachId,
        createdAt,
      }).run()
      seriesCreated = true
    }
    database.insert(schema.sessionAssignments).values({
      id: `preparation-assignment-${label}`,
      accountId: playerId,
      seriesId,
      effectiveFrom: "2026-01-01",
      assignedByAccountId: coachId,
      assignedAt: createdAt,
    }).run()
    return playerId
  }

  function prepare(period: string, key: string, createFeeReference?: () => string) {
    return finance.prepareMonthlyCharges({ period, idempotencyKey: key }, {
      coachId,
      createFeeReference,
      createId,
      database,
      now,
    })
  }

  beforeAll(async () => {
    schema = await import("@/lib/db/schema")
    finance = await import("@/lib/finance/service")
    domain = await import("@/lib/finance/domain")
    const { prepareDatabase } = await import("@/lib/db/setup")
    database = prepareDatabase({ seed: true })
    finance.activateFinance({
      trackingMonth: "2026-08",
      idempotencyKey: "preparation-round-trips-activation",
    }, { coachId, createId, database, now })
  })

  afterAll(() => {
    BetterSqlite3.prototype.prepare = originalPrepare
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  it("costs the same two writes per charge whether it prepares three or twelve", () => {
    const small = ["Small1", "Small2", "Small3"].map(enrol)
    // August is every one of these players' first billed month, which reads the
    // session calendar to prorate. September and October are the ordinary
    // months the per-charge constant is about, so August is left unmeasured.
    prepare("2026-08", "00000000-0000-4000-8000-000000008001")
    const forThree = countStatements(() => prepare(
      "2026-09",
      "00000000-0000-4000-8000-000000009001",
    ))

    const large = ["Large1", "Large2", "Large3", "Large4", "Large5",
      "Large6", "Large7", "Large8", "Large9"].map(enrol)
    prepare("2026-08", "00000000-0000-4000-8000-000000008002")
    prepare("2026-09", "00000000-0000-4000-8000-000000009002")
    const forTwelve = countStatements(() => prepare(
      "2026-10",
      "00000000-0000-4000-8000-000000010001",
    ))

    expect(forThree.value.ready).toBe(small.length)
    expect(forTwelve.value.ready).toBe(small.length + large.length)

    /*
     * Nine more charges may cost only their own two writes. The reads that used
     * to sit beside them -- the already-issued lookup the caller had already
     * batched, the read-back of the row the insert just wrote, and the probe
     * proving the fee reference free -- put this at five before they were
     * hoisted.
     */
    const perCharge = (forTwelve.statements - forThree.statements) / large.length
    expect(perCharge).toBe(2)
  })

  it("still issues one valid, unique fee reference per prepared charge", () => {
    const charges = database.select().from(schema.financialCharges)
      .where(eq(schema.financialCharges.billingPeriod, "2026-10")).all()
    expect(charges).toHaveLength(12)
    const references = charges.map((charge) => charge.feeReference)
    expect(references.every((reference) => domain.isValidFeeReference(reference))).toBe(true)
    expect(new Set(references).size).toBe(references.length)
    expect(charges.every((charge) => charge.originalAmountPaise === 100_000)).toBe(true)
    expect(charges.every((charge) => charge.lifecycle === "issued")).toBe(true)

    // The `returning` row the loop now records is the row that was written.
    charges.forEach((charge) => {
      expect(database.select().from(schema.financialAuditEvents).where(and(
        eq(schema.financialAuditEvents.entityId, charge.id),
        eq(schema.financialAuditEvents.eventType, "charge_issued"),
      )).all()).toHaveLength(1)
    })
  })

  it("skips a reserved reference that a charge already holds", () => {
    const taken = database.select().from(schema.financialCharges)
      .where(eq(schema.financialCharges.billingPeriod, "2026-10")).all()[0].feeReference
    // The unique index is on `lower(fee_reference)`, so the reservation has to
    // reject this draw on case-insensitive evidence, not on an exact match.
    const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
    const offered = [
      taken.toLowerCase(),
      "SMBA-7K4M2P8Q",
      ...Array.from({ length: 20 }, (_, index) => (
        `SMBA-QQQQQQ${alphabet[index]}${alphabet[index]}`
      )),
    ]
    const createFeeReference = () => offered.shift() ?? "SMBA-ZZZZZZZZ"

    const contender = enrol("Contender")
    // Two earlier months so November is not a first billed month for anyone,
    // keeping this run on the reserved path rather than the per-charge probe.
    prepare("2026-08", "00000000-0000-4000-8000-000000008003")
    prepare("2026-09", "00000000-0000-4000-8000-000000009003")
    prepare("2026-10", "00000000-0000-4000-8000-000000010002")
    const prepared = prepare(
      "2026-11",
      "00000000-0000-4000-8000-000000011001",
      createFeeReference,
    )

    expect(prepared.ready).toBe(13)
    const november = database.select().from(schema.financialCharges)
      .where(eq(schema.financialCharges.billingPeriod, "2026-11")).all()
    const references = november.map((charge) => charge.feeReference)
    expect(references).not.toContain(taken)
    expect(references).not.toContain(taken.toLowerCase())
    expect(new Set(references).size).toBe(november.length)
    expect(references).toContain("SMBA-7K4M2P8Q")
    expect(november.map((charge) => charge.playerAccountId)).toContain(contender)
  })

  it("re-prepares a month without issuing a second charge for anyone", () => {
    const before = database.select().from(schema.financialCharges)
      .where(eq(schema.financialCharges.billingPeriod, "2026-10")).all()
    const rerun = prepare("2026-10", "00000000-0000-4000-8000-000000010003")

    expect(rerun.ready).toBe(0)
    expect(rerun.alreadyPrepared).toBe(before.length)
    expect(database.select().from(schema.financialCharges)
      .where(eq(schema.financialCharges.billingPeriod, "2026-10")).all())
      .toHaveLength(before.length)
  })
})

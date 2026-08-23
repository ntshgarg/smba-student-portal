import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { calculateProratedSessionFee, createOpaqueFeeReference } from "@/lib/finance/domain"
import { MAX_TRAINING_START_BACKFILL_MONTHS } from "@/lib/training/training-start"
import type { OnboardingFinanceTerms } from "@/lib/finance/types"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-training-start-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "training-start.db")

describe("training start billing and correction", () => {
  let accountService: typeof import("@/lib/auth/account-service")
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let finance: typeof import("@/lib/finance/service")
  let schema: typeof import("@/lib/db/schema")
  let sessions: typeof import("@/lib/sessions/service")

  const coachId = "00000000-0000-4000-8000-000000000001"
  const monthlyFeePaise = 350_000
  const onboardingNow = new Date("2026-08-18T10:00:00+05:30")

  let nextId = 0
  const ids = () => `training-start-${String(nextId += 1).padStart(4, "0")}`
  const references = createOpaqueFeeReference

  type PlayerFixture = {
    assignments: Array<{ from: string; to?: string }>
    name: string
    occurrences: string[]
    seriesStartsOn: string
    trainingStartOn: string
  }

  function createPlayer({
    assignments,
    name,
    occurrences,
    seriesStartsOn,
    trainingStartOn,
  }: PlayerFixture) {
    const playerId = accountService.registerAccount(name, "player")
    accountService.approveRegistration(playerId, coachId, { now: onboardingNow })
    database.update(schema.playerEnrollments).set({
      academyPlan: "weekday-3-day",
      batch: "Weekday",
      level: "Beginner",
      status: "active",
      trainingStartConfirmedAt: onboardingNow,
      trainingStartConfirmedByAccountId: coachId,
      trainingStartOn,
      updatedAt: onboardingNow,
    }).where(eq(schema.playerEnrollments.accountId, playerId)).run()

    const seriesId = ids()
    database.insert(schema.sessionSeries).values({
      id: seriesId,
      batch: "Weekday",
      createdAt: onboardingNow,
      createdByAccountId: coachId,
      programme: "Beginner",
      startsOn: seriesStartsOn,
      status: "active",
      title: `${name} series`,
      venue: "SMBA Court",
    }).run()

    const weekdays = [...new Set(occurrences.map((date) => (
      new Date(`${date}T00:00:00.000Z`).getUTCDay()
    )))]
    assignments.forEach(({ from, to }) => {
      const assignmentId = ids()
      database.insert(schema.sessionAssignments).values({
        id: assignmentId,
        accountId: playerId,
        assignedAt: onboardingNow,
        assignedByAccountId: coachId,
        effectiveFrom: from,
        effectiveTo: to ?? null,
        seriesId,
      }).run()
      database.insert(schema.sessionAssignmentWeekdays).values(weekdays.map((weekday) => ({
        id: ids(),
        assignmentId,
        weekday,
      }))).run()
    })

    const occurrenceIds = new Map<string, string>()
    occurrences.forEach((date) => {
      const occurrenceId = ids()
      occurrenceIds.set(date, occurrenceId)
      database.insert(schema.sessionOccurrences).values({
        id: occurrenceId,
        createdAt: onboardingNow,
        durationMinutes: 60,
        occurrenceDate: date,
        seriesId,
        startsAt: new Date(`${date}T06:00:00+05:30`),
        status: "scheduled",
        venue: "SMBA Court",
      }).run()
    })

    return { occurrenceIds, playerId, seriesId }
  }

  function terms(playerId: string): OnboardingFinanceTerms {
    return {
      academyPlan: "weekday-3-day",
      agreedMonthlyFeePaise: monthlyFeePaise,
      batch: "Weekday",
      level: "Beginner",
      playerId,
    }
  }

  function onboard(playerId: string, now: Date) {
    const context = { coachId, createFeeReference: references, createId: ids, database, now }
    const preview = finance.previewPlayerOnboardingFinance(terms(playerId), context)
    return {
      completed: finance.completePlayerOnboardingFinance({
        ...terms(playerId),
        previewFingerprint: preview.fingerprint,
      }, context),
      preview,
    }
  }

  function prepare(period: string, idempotencyKey: string, now: Date) {
    return finance.prepareMonthlyCharges({ idempotencyKey, period }, {
      coachId,
      createFeeReference: references,
      createId: ids,
      database,
      now,
    })
  }

  function monthlyCharge(playerId: string, billingPeriod: string) {
    return database.select().from(schema.financialCharges).where(and(
      eq(schema.financialCharges.playerAccountId, playerId),
      eq(schema.financialCharges.type, "monthly_training"),
      eq(schema.financialCharges.billingPeriod, billingPeriod),
    )).all()
  }

  beforeAll(async () => {
    accountService = await import("@/lib/auth/account-service")
    schema = await import("@/lib/db/schema")
    finance = await import("@/lib/finance/service")
    sessions = await import("@/lib/sessions/service")
    const { prepareDatabase } = await import("@/lib/db/setup")
    database = prepareDatabase({ seed: true })
    finance.activateFinance({
      idempotencyKey: "activate-training-start-finance",
      trackingMonth: "2026-06",
    }, { coachId, createId: ids, database, now: onboardingNow })
  })

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  it("prorates a future mid-month first fee month issued by the monthly run", () => {
    const { playerId } = createPlayer({
      assignments: [{ from: "2026-09-15" }],
      name: "Future Mid Month Player",
      occurrences: [
        "2026-09-01", "2026-09-03", "2026-09-08", "2026-09-10", "2026-09-15",
        "2026-09-17", "2026-09-22", "2026-09-24", "2026-09-29",
      ],
      seriesStartsOn: "2026-08-01",
      trainingStartOn: "2026-08-18",
    })

    const { completed, preview } = onboard(playerId, onboardingNow)
    expect(preview.blockers).toEqual([])
    expect(preview.feePlanStartOn).toBe("2026-09-01")
    expect(completed.createdMonthlyChargeIds).toEqual([])
    expect(completed.firstMonthlyChargeId).toBeNull()

    const september = prepare("2026-09", "issue-future-mid-month", new Date("2026-09-20T10:00:00+05:30"))
    const charges = monthlyCharge(playerId, "2026-09")
    expect(charges).toHaveLength(1)
    expect(september.createdChargeIds).toContain(charges[0].id)
    expect(charges[0]).toMatchObject({
      description: "First monthly training fee · 5/9 sessions",
      dueDate: "2026-09-05",
      originalAmountPaise: calculateProratedSessionFee(monthlyFeePaise, 5, 9),
    })
    expect(charges[0].originalAmountPaise).toBe(195_000)

    // The recorded, replayable result carries the prorated charge, not a fresh one.
    const replay = prepare("2026-09", "issue-future-mid-month", new Date("2026-09-20T10:00:00+05:30"))
    expect(replay).toMatchObject({
      createdChargeIds: september.createdChargeIds,
      reused: true,
    })
    expect(monthlyCharge(playerId, "2026-09")).toHaveLength(1)

    // A later month is the whole agreed fee, not a repeat of the partial one.
    prepare("2026-10", "issue-october-after-proration", new Date("2026-10-02T10:00:00+05:30"))
    expect(monthlyCharge(playerId, "2026-10")).toEqual([expect.objectContaining({
      description: "Monthly training fee · 2026-10",
      originalAmountPaise: monthlyFeePaise,
    })])
  })

  it("hands a deferred first fee month to the next month’s bulk issue in full", () => {
    const { playerId } = createPlayer({
      assignments: [{ from: "2026-11-03" }],
      name: "Deferred Month Player",
      occurrences: ["2026-11-03", "2026-11-10", "2026-11-17", "2026-11-24"],
      seriesStartsOn: "2026-11-03",
      trainingStartOn: "2026-08-18",
    })

    const { completed, preview } = onboard(playerId, onboardingNow)
    expect(preview.warnings).toContain("No monthly charge is due now; the Fee Plan begins in 2026-11.")
    expect(completed.firstMonthlyChargeId).toBeNull()
    expect(finance.getPlayerFeeRecord(playerId, { database, now: onboardingNow })).toMatchObject({
      monthlyCharges: [],
      registrationCharge: expect.any(Object),
    })

    const november = prepare("2026-11", "issue-november-fees", new Date("2026-11-04T10:00:00+05:30"))
    const charges = monthlyCharge(playerId, "2026-11")
    expect(charges).toHaveLength(1)
    expect(november.createdChargeIds).toContain(charges[0].id)
    expect(charges[0]).toMatchObject({
      description: "Monthly training fee · 2026-11",
      originalAmountPaise: monthlyFeePaise,
    })
  })

  it("leaves a month already prepared at the full fee unprorated", () => {
    const { playerId } = createPlayer({
      assignments: [{ from: "2026-12-01" }],
      name: "Already Prepared Player",
      occurrences: ["2026-12-01", "2026-12-08", "2026-12-15", "2026-12-22"],
      seriesStartsOn: "2026-12-01",
      trainingStartOn: "2026-12-15",
    })
    const agreementId = ids()
    database.insert(schema.feeAgreements).values({
      id: agreementId,
      playerAccountId: playerId,
      academyPlan: "weekday-3-day",
      level: "Beginner",
      batch: "Weekday",
      agreedMonthlyFeePaise: monthlyFeePaise,
      currency: "INR",
      monthlyDueDay: 5,
      effectiveFrom: "2026-12-01",
      effectiveTo: null,
      status: "active",
      recordRevision: 0,
      createdByAccountId: coachId,
      createdAt: onboardingNow,
      updatedByAccountId: coachId,
      updatedAt: onboardingNow,
    }).run()
    const chargeId = ids()
    database.insert(schema.financialCharges).values({
      billingPeriod: "2026-12",
      feeAgreementId: agreementId,
      description: "Monthly training fee · 2026-12",
      dueDate: "2026-12-05",
      feeReference: references(),
      id: chargeId,
      issuedAt: onboardingNow,
      issuedByAccountId: coachId,
      originalAmountPaise: monthlyFeePaise,
      playerAccountId: playerId,
      type: "monthly_training",
    }).run()

    const december = prepare("2026-12", "re-run-december", new Date("2026-12-20T10:00:00+05:30"))
    expect(december.createdChargeIds).not.toContain(chargeId)
    expect(december.alreadyPrepared).toBeGreaterThanOrEqual(1)
    expect(monthlyCharge(playerId, "2026-12")).toEqual([expect.objectContaining({
      id: chargeId,
      originalAmountPaise: monthlyFeePaise,
    })])
  })

  it("onboards a player whose pause left an uncovered month", () => {
    const { playerId } = createPlayer({
      assignments: [{ from: "2026-06-01", to: "2026-07-01" }, { from: "2026-08-01" }],
      name: "Paused And Returned Player",
      occurrences: [
        "2026-06-02", "2026-06-09", "2026-06-16", "2026-06-23", "2026-06-30",
        "2026-07-07", "2026-07-14", "2026-07-21", "2026-07-28",
        "2026-08-04", "2026-08-11", "2026-08-18",
      ],
      seriesStartsOn: "2026-06-01",
      trainingStartOn: "2026-06-02",
    })

    const { completed, preview } = onboard(playerId, onboardingNow)
    expect(preview.blockers).toEqual([])
    expect(preview.warnings).toContain(
      "No session assignment covers 2026-07; no fee is due for those months.",
    )
    expect(preview.lines.filter(({ kind }) => kind === "monthly_training")
      .map(({ period }) => period)).toEqual(["2026-06", "2026-08"])
    expect(completed.createdMonthlyChargeIds).toHaveLength(2)
    expect(database.select().from(schema.financialCharges).where(and(
      eq(schema.financialCharges.playerAccountId, playerId),
      eq(schema.financialCharges.type, "monthly_training"),
    )).all().map(({ billingPeriod }) => billingPeriod)).toEqual(["2026-06", "2026-08"])
  })

  it("still refuses a confirmed training start beyond the backfill window", () => {
    const { playerId } = createPlayer({
      assignments: [{ from: "2024-01-08" }],
      name: "Implausible Backfill Player",
      occurrences: ["2024-01-08", "2026-08-10", "2026-08-17"],
      seriesStartsOn: "2024-01-08",
      trainingStartOn: "2024-01-08",
    })

    const preview = finance.previewPlayerOnboardingFinance(terms(playerId), {
      coachId,
      database,
      now: onboardingNow,
    })
    expect(preview.blockers).toContain(
      `Choose a training start date within the last ${MAX_TRAINING_START_BACKFILL_MONTHS} months.`,
    )
    expect(() => finance.completePlayerOnboardingFinance({
      ...terms(playerId),
      previewFingerprint: preview.fingerprint,
    }, { coachId, createFeeReference: references, createId: ids, database, now: onboardingNow }))
      .toThrow(expect.objectContaining({ code: "SETUP_REQUIRED" }))
    expect(database.select().from(schema.feeAgreements)
      .where(eq(schema.feeAgreements.playerAccountId, playerId)).all()).toHaveLength(0)
    expect(database.select().from(schema.financialCharges)
      .where(eq(schema.financialCharges.playerAccountId, playerId)).all()).toHaveLength(0)
  })

  it("refuses a re-date that contradicts an issued fee, then permits it once resolved", () => {
    const { occurrenceIds, playerId } = createPlayer({
      assignments: [{ from: "2026-07-01" }],
      name: "Late Confirmation Player",
      occurrences: [
        "2026-07-07", "2026-07-14", "2026-07-21", "2026-07-28",
        "2026-08-04", "2026-08-11", "2026-08-18", "2026-08-25",
      ],
      seriesStartsOn: "2026-07-01",
      trainingStartOn: "2026-08-15",
    })
    const { completed } = onboard(playerId, onboardingNow)
    expect(completed.firstMonthlyFeePaise).toBe(calculateProratedSessionFee(monthlyFeePaise, 2, 4))

    const redate = (idempotencyKey: string, expectedRevision: number) => (
      finance.redateConfirmedTrainingStart({
        expectedRevision,
        idempotencyKey,
        playerId,
        reason: "The player actually began training on 1 July",
        trainingStartOn: "2026-07-01",
      }, { coachId, createId: ids, database, now: onboardingNow })
    )
    const revision = () => database.select().from(schema.playerEnrollments)
      .where(eq(schema.playerEnrollments.accountId, playerId)).get()?.recordRevision ?? -1

    expect(() => redate("redate-blocked", revision())).toThrow(expect.objectContaining({
      code: "CONFLICT",
      message: "Void the 2026-08 monthly fee before correcting the training start date.",
    }))

    finance.voidCharge({
      chargeId: completed.firstMonthlyChargeId ?? "missing",
      expectedChargeRevision: 0,
      idempotencyKey: "void-mis-dated-august",
      reason: "Re-based after correcting the training start date",
    }, { coachId, createId: ids, database, now: onboardingNow })

    const expectedRevision = revision()
    const applied = redate("redate-permitted", expectedRevision)
    expect(applied).toMatchObject({
      agreementEffectiveFrom: "2026-07-01",
      previousTrainingStartOn: "2026-08-15",
      recordRevision: expectedRevision + 1,
      reopenedPeriods: ["2026-07", "2026-08"],
      reused: false,
      trainingStartOn: "2026-07-01",
    })
    expect(database.select().from(schema.playerEnrollments)
      .where(eq(schema.playerEnrollments.accountId, playerId)).get()).toMatchObject({
      trainingStartConfirmedByAccountId: coachId,
      trainingStartOn: "2026-07-01",
    })
    expect(redate("redate-permitted", expectedRevision)).toMatchObject({ reused: true })

    const event = database.select().from(schema.financialAuditEvents).where(and(
      eq(schema.financialAuditEvents.entityId, playerId),
      eq(schema.financialAuditEvents.eventType, "training_start_redated"),
    )).get()
    expect(JSON.parse(event?.metadata ?? "{}")).toMatchObject({
      operation: "training_start_redated",
      reason: "The player actually began training on 1 July",
    })

    // The reopened months become billable and recordable again.
    prepare("2026-07", "issue-reopened-july", new Date("2026-08-18T10:00:00+05:30"))
    expect(monthlyCharge(playerId, "2026-07")).toEqual([expect.objectContaining({
      originalAmountPaise: monthlyFeePaise,
    })])
    prepare("2026-08", "reissue-august-at-full-fee", new Date("2026-08-18T10:00:00+05:30"))
    expect(monthlyCharge(playerId, "2026-08").filter(({ lifecycle }) => lifecycle === "issued"))
      .toEqual([expect.objectContaining({ originalAmountPaise: monthlyFeePaise })])

    expect(sessions.saveSessionAttendanceRecords({
      changes: [{
        choice: "present",
        expectedChoice: "cleared",
        occurrenceId: occurrenceIds.get("2026-07-07") ?? "missing",
        playerId,
      }],
      coachId,
      database,
      now: onboardingNow,
      referenceDate: "2026-08-18",
    })).toEqual({ applied: 1 })
  })

  it("refuses a re-date that moves the confirmed start later", () => {
    const { playerId } = createPlayer({
      assignments: [{ from: "2027-01-04" }],
      name: "Forward Redate Player",
      occurrences: ["2027-01-04", "2027-01-11", "2027-01-18", "2027-01-25"],
      seriesStartsOn: "2027-01-04",
      trainingStartOn: "2027-01-04",
    })
    const now = new Date("2027-01-06T10:00:00+05:30")
    onboard(playerId, now)
    const enrollment = database.select().from(schema.playerEnrollments)
      .where(eq(schema.playerEnrollments.accountId, playerId)).get()

    expect(() => finance.redateConfirmedTrainingStart({
      expectedRevision: enrollment?.recordRevision ?? -1,
      idempotencyKey: "redate-forward",
      playerId,
      reason: "Attempting to move the start later",
      trainingStartOn: "2027-01-18",
    }, { coachId, createId: ids, database, now })).toThrow(expect.objectContaining({
      code: "INVALID_INPUT",
      field: "trainingStartOn",
    }))
    expect(database.select().from(schema.playerEnrollments)
      .where(eq(schema.playerEnrollments.accountId, playerId)).get()?.trainingStartOn)
      .toBe("2027-01-04")
  })
})

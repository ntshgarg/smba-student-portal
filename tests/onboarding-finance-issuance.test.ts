import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { calculateProratedSessionFee } from "@/lib/finance/domain"
import type {
  OnboardingFinanceTerms,
} from "@/lib/finance/types"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-onboarding-finance-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "smba-test.db")

function valueFactory(prefix: string) {
  let next = 0
  return () => `${prefix}-${String(next += 1).padStart(4, "0")}`
}

describe("onboarding finance issuance", () => {
  let accountService: typeof import("@/lib/auth/account-service")
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let finance: typeof import("@/lib/finance/service")
  let schema: typeof import("@/lib/db/schema")

  const coachId = "00000000-0000-4000-8000-000000000001"
  const ids = valueFactory("onboarding-finance")
  const feeReferences = [
    "SMBA-23456789",
    "SMBA-3456789A",
    "SMBA-456789AB",
    "SMBA-56789ABC",
    "SMBA-6789ABCD",
    "SMBA-789ABCDE",
    "SMBA-89ABCDEF",
    "SMBA-9ABCDEFG",
    "SMBA-BCDEFGHJ",
    "SMBA-CDEFGHJK",
    "SMBA-DEFGHJKL",
    "SMBA-EFGHJKLM",
    "SMBA-FGHJKLMN",
    "SMBA-GHJKLMNP",
  ]
  const references = () => feeReferences.shift() ?? "SMBA-ABCDEFGH"
  const onboardingNow = new Date("2026-08-18T10:00:00+05:30")
  const previewFingerprints = new Map<string, string>()

  type TestOnboardingInput = OnboardingFinanceTerms & {
    effectiveFrom?: string
    idempotencyKey?: string
  }

  function financeTerms(input: TestOnboardingInput): OnboardingFinanceTerms {
    return {
      academyPlan: input.academyPlan,
      agreedMonthlyFeePaise: input.agreedMonthlyFeePaise,
      batch: input.batch,
      level: input.level,
      monthlyDueDay: input.monthlyDueDay,
      playerId: input.playerId,
    }
  }

  function completeFromPreview(
    input: TestOnboardingInput,
    context: Parameters<typeof finance.completePlayerOnboardingFinance>[1],
  ) {
    const replayKey = input.idempotencyKey ?? input.playerId
    let previewFingerprint = previewFingerprints.get(replayKey)
    if (!previewFingerprint) {
      const preview = finance.previewPlayerOnboardingFinance(financeTerms(input), context)
      previewFingerprint = preview.fingerprint
      previewFingerprints.set(replayKey, previewFingerprint)
    }
    return finance.completePlayerOnboardingFinance({
      ...financeTerms(input),
      previewFingerprint,
    }, context)
  }

  function createAssessedPlayer({
    assignmentFrom,
    assignmentTo,
    name,
    occurrences = [],
    trainingStartOn = assignmentFrom,
  }: {
    assignmentFrom: string
    assignmentTo?: string
    name: string
    occurrences?: Array<{
      date: string
      replacementForDate?: string
      startTime?: string
      status?: "scheduled" | "cancelled"
    }>
    trainingStartOn?: string
  }) {
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
      startsOn: occurrences[0]?.date ?? assignmentFrom,
      status: "active",
      title: `${name} series`,
      venue: "SMBA Court",
    }).run()
    const assignmentId = ids()
    database.insert(schema.sessionAssignments).values({
      id: assignmentId,
      accountId: playerId,
      assignedAt: onboardingNow,
      assignedByAccountId: coachId,
      effectiveFrom: assignmentFrom,
      effectiveTo: assignmentTo,
      seriesId,
    }).run()
    const weekdays = [...new Set(occurrences.map(({ date }) => (
      new Date(`${date}T00:00:00.000Z`).getUTCDay()
    )))]
    if (weekdays.length) {
      database.insert(schema.sessionAssignmentWeekdays).values(weekdays.map((weekday) => ({
        id: ids(),
        assignmentId,
        weekday,
      }))).run()
    }
    if (occurrences.length) {
      const occurrenceRows = occurrences.map((occurrence) => ({
        ...occurrence,
        id: ids(),
      }))
      database.insert(schema.sessionOccurrences).values(occurrenceRows.map((occurrence) => ({
        id: occurrence.id,
        createdAt: onboardingNow,
        durationMinutes: 60,
        occurrenceDate: occurrence.date,
        replacementForOccurrenceId: occurrence.replacementForDate
          ? occurrenceRows.find(({ date }) => date === occurrence.replacementForDate)?.id
          : null,
        seriesId,
        startsAt: new Date(`${occurrence.date}T${occurrence.startTime ?? "06:00"}:00+05:30`),
        status: occurrence.status ?? "scheduled",
        venue: "SMBA Court",
      }))).run()
    }
    return playerId
  }

  beforeAll(async () => {
    accountService = await import("@/lib/auth/account-service")
    schema = await import("@/lib/db/schema")
    finance = await import("@/lib/finance/service")
    const { prepareDatabase } = await import("@/lib/db/setup")
    database = prepareDatabase({ seed: true })
    finance.activateFinance({
      idempotencyKey: "activate-onboarding-finance",
      trackingMonth: "2026-08",
    }, { coachId, createId: ids, database, now: onboardingNow })
  })

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  it("atomically issues registration and the current first month without duplicates", () => {
    const playerId = createAssessedPlayer({
      assignmentFrom: "2026-08-15",
      name: "Current Month Player",
      occurrences: [
        "03", "05", "07", "10", "12", "14", "17", "19", "21", "24", "26", "28",
      ].map((day) => ({ date: `2026-08-${day}` })),
    })
    expect(database.select().from(schema.financialCharges).where(eq(
      schema.financialCharges.playerAccountId,
      playerId,
    )).all()).toHaveLength(0)

    const input = {
      academyPlan: "weekday-3-day" as const,
      agreedMonthlyFeePaise: 350_000,
      batch: "Weekday" as const,
      effectiveFrom: "2026-08-01",
      idempotencyKey: "complete-current-month-onboarding",
      level: "Beginner" as const,
      playerId,
    }
    const completed = completeFromPreview(input, {
      coachId,
      createFeeReference: references,
      createId: ids,
      database,
      now: onboardingNow,
    })
    expect(completed).toMatchObject({
      firstMonthlyChargeId: expect.any(String),
      firstMonthlyFeePaise: 175_000,
      firstMonthlyRemainingSessions: 6,
      firstMonthlyTotalSessions: 12,
      registrationChargeId: expect.any(String),
      reused: false,
    })
    expect(finance.getPlayerFeeRecord(playerId, { database, now: onboardingNow })).toMatchObject({
      registrationCharge: {
        dueDate: "2026-08-18",
        originalAmountPaise: 100_000,
      },
      monthlyCharges: [expect.objectContaining({
        billingPeriod: "2026-08",
        dueDate: "2026-08-21",
        originalAmountPaise: 175_000,
      })],
    })

    expect(completeFromPreview(input, {
      coachId,
      createFeeReference: references,
      createId: ids,
      database,
      now: onboardingNow,
    })).toMatchObject({ reused: true })
    expect(finance.prepareMonthlyCharges({
      idempotencyKey: "issue-august-after-onboarding",
      period: "2026-08",
    }, {
      coachId,
      createFeeReference: references,
      createId: ids,
      database,
      now: onboardingNow,
    })).toMatchObject({ alreadyPrepared: 1, createdChargeIds: [], ready: 0 })
    expect(database.select().from(schema.financialCharges).where(eq(
      schema.financialCharges.playerAccountId,
      playerId,
    )).all()).toHaveLength(2)

    finance.prepareMonthlyCharges({
      idempotencyKey: "issue-september-after-prorated-onboarding",
      period: "2026-09",
    }, {
      coachId,
      createFeeReference: references,
      createId: ids,
      database,
      now: new Date("2026-09-01T10:00:00+05:30"),
    })
    expect(database.select().from(schema.financialCharges).where(and(
      eq(schema.financialCharges.playerAccountId, playerId),
      eq(schema.financialCharges.billingPeriod, "2026-09"),
    )).get()?.originalAmountPaise).toBe(350_000)
  })

  it("completes a signup into a batch that has not started, billing nothing early", () => {
    const playerId = createAssessedPlayer({
      assignmentFrom: "2026-09-01",
      name: "Future Month Player",
      occurrences: ["02", "04", "07"].map((day) => ({ date: `2026-09-${day}` })),
    })
    const terms = {
      academyPlan: "weekday-3-day",
      agreedMonthlyFeePaise: 350_000,
      batch: "Weekday",
      level: "Beginner",
      playerId,
    } as const
    const context = {
      coachId,
      database,
      now: onboardingNow,
    }
    /*
     * A future start used to be a blocker AND a warning. The blocker meant a
     * coach who signed a player up in August for a September batch had to come
     * back in September to settle a registration fee that was owed in August.
     * The warning already describes the state exactly and lets it through, and
     * nothing is billed early: no monthly charge is issued for a period the fee
     * plan has not reached.
     */
    const preview = finance.previewPlayerOnboardingFinance(terms, context)
    expect(preview.blockers).toEqual([])
    expect(preview.warnings).toContain("No monthly charge is due now; the Fee Plan begins in 2026-09.")

    finance.completePlayerOnboardingFinance({
      ...terms,
      previewFingerprint: preview.fingerprint,
    }, context)

    const charges = database.select().from(schema.financialCharges).where(eq(
      schema.financialCharges.playerAccountId,
      playerId,
    )).all()
    expect(charges.map((charge) => charge.type)).toEqual(["registration"])
  })

  it("derives the first fee month instead of accepting a caller-selected month", () => {
    const playerId = createAssessedPlayer({
      assignmentFrom: "2026-09-01",
      assignmentTo: "2026-09-30",
      name: "Expired Future Assignment Player",
      occurrences: [{ date: "2026-09-02" }],
    })

    const preview = finance.previewPlayerOnboardingFinance({
      academyPlan: "weekday-3-day",
      agreedMonthlyFeePaise: 350_000,
      batch: "Weekday",
      level: "Beginner",
      playerId,
    }, {
      coachId,
      database,
      now: new Date("2026-09-02T10:00:00+05:30"),
    })
    expect(preview.feePlanStartOn).toBe("2026-09-01")
    expect(preview.lines.filter((line) => line.kind === "monthly_training"))
      .toEqual([expect.objectContaining({ period: "2026-09" })])
  })

  it("does not manufacture a fee for a month before the assignment begins", () => {
    const playerId = createAssessedPlayer({
      assignmentFrom: "2026-09-01",
      name: "Invalid Month Player",
      occurrences: [{ date: "2026-09-02" }],
    })
    const preview = finance.previewPlayerOnboardingFinance({
      academyPlan: "weekday-3-day",
      agreedMonthlyFeePaise: 350_000,
      batch: "Weekday",
      level: "Beginner",
      playerId,
    }, {
      coachId,
      database,
      now: new Date("2026-09-02T10:00:00+05:30"),
    })
    expect(preview.lines.some((line) => line.period === "2026-08")).toBe(false)
    expect(preview.lines).toContainEqual(expect.objectContaining({ period: "2026-09" }))
  })

  it("counts a later same-day session and excludes cancelled training days", () => {
    const playerId = createAssessedPlayer({
      assignmentFrom: "2026-08-01",
      name: "Same Day Player",
      occurrences: [
        { date: "2026-08-04" },
        { date: "2026-08-11" },
        { date: "2026-08-18", startTime: "18:00" },
        { date: "2026-08-25", status: "cancelled" },
      ],
      trainingStartOn: "2026-08-18",
    })
    const completed = completeFromPreview({
      academyPlan: "weekday-3-day",
      agreedMonthlyFeePaise: 350_000,
      batch: "Weekday",
      effectiveFrom: "2026-08-01",
      idempotencyKey: "complete-same-day-onboarding",
      level: "Beginner",
      playerId,
    }, { coachId, createFeeReference: references, createId: ids, database, now: onboardingNow })

    expect(completed).toMatchObject({
      firstMonthlyFeePaise: 115_000,
      firstMonthlyRemainingSessions: 1,
      firstMonthlyTotalSessions: 3,
    })

    const issuedCharge = database.select().from(schema.financialCharges).where(and(
      eq(schema.financialCharges.playerAccountId, playerId),
      eq(schema.financialCharges.type, "monthly_training"),
    )).get()
    database.update(schema.sessionOccurrences).set({
      status: "cancelled",
    }).where(eq(schema.sessionOccurrences.occurrenceDate, "2026-08-18")).run()
    expect(database.select().from(schema.financialCharges).where(eq(
      schema.financialCharges.id,
      issuedCharge?.id ?? "missing-charge",
    )).get()).toMatchObject({
      originalAmountPaise: 115_000,
      recordRevision: issuedCharge?.recordRevision,
    })
  })

  it("includes a session whose eligibility date equals the training start date", () => {
    const playerId = createAssessedPlayer({
      assignmentFrom: "2026-08-01",
      name: "Exact Start Player",
      occurrences: [
        { date: "2026-08-18", startTime: "10:00" },
        { date: "2026-08-25", startTime: "10:00" },
      ],
      trainingStartOn: "2026-08-18",
    })
    const completed = completeFromPreview({
      academyPlan: "weekday-3-day",
      agreedMonthlyFeePaise: 350_000,
      batch: "Weekday",
      effectiveFrom: "2026-08-01",
      idempotencyKey: "complete-at-exact-session-start",
      level: "Beginner",
      playerId,
    }, { coachId, createFeeReference: references, createId: ids, database, now: onboardingNow })

    expect(completed).toMatchObject({
      firstMonthlyFeePaise: 350_000,
      firstMonthlyRemainingSessions: 2,
      firstMonthlyTotalSessions: 2,
    })
  })

  it("rejects a partial fee that would round to a zero-value charge", () => {
    const playerId = createAssessedPlayer({
      assignmentFrom: "2026-08-01",
      name: "Tiny Fee Player",
      occurrences: [
        { date: "2026-08-04" },
        { date: "2026-08-11" },
        { date: "2026-08-18" },
      ],
      trainingStartOn: "2026-08-18",
    })

    expect(() => completeFromPreview({
      academyPlan: "weekday-3-day",
      agreedMonthlyFeePaise: 100,
      batch: "Weekday",
      effectiveFrom: "2026-08-01",
      idempotencyKey: "reject-zero-rounded-fee",
      level: "Beginner",
      playerId,
    }, { coachId, createFeeReference: references, createId: ids, database, now: onboardingNow }))
      .toThrow(expect.objectContaining({ code: "SETUP_REQUIRED" }))
    expect(database.select().from(schema.feeAgreements).where(eq(
      schema.feeAgreements.playerAccountId,
      playerId,
    )).all()).toHaveLength(0)
    expect(database.select().from(schema.financialCharges).where(eq(
      schema.financialCharges.playerAccountId,
      playerId,
    )).all()).toHaveLength(0)
  })

  it("creates no joining-month fee when no sessions remain and starts the plan next month", () => {
    const playerId = createAssessedPlayer({
      assignmentFrom: "2026-08-01",
      name: "After Sessions Player",
      occurrences: [{ date: "2026-08-04" }, { date: "2026-08-11" }],
      trainingStartOn: "2026-08-18",
    })
    const completed = completeFromPreview({
      academyPlan: "weekday-3-day",
      agreedMonthlyFeePaise: 350_000,
      batch: "Weekday",
      effectiveFrom: "2026-08-01",
      idempotencyKey: "complete-after-sessions-onboarding",
      level: "Beginner",
      playerId,
    }, { coachId, createFeeReference: references, createId: ids, database, now: onboardingNow })

    expect(completed).toMatchObject({
      firstMonthlyChargeId: null,
      firstMonthlyFeePaise: null,
      firstMonthlyRemainingSessions: null,
      firstMonthlyTotalSessions: null,
    })
    expect(database.select().from(schema.feeAgreements).where(eq(
      schema.feeAgreements.playerAccountId,
      playerId,
    )).get()?.effectiveFrom).toBe("2026-09-01")
    expect(database.select().from(schema.financialCharges).where(and(
      eq(schema.financialCharges.playerAccountId, playerId),
      eq(schema.financialCharges.type, "monthly_training"),
    )).all()).toHaveLength(0)
  })

  it("rolls back onboarding finance when the assigned calendar has no scheduled sessions", () => {
    const playerId = createAssessedPlayer({
      assignmentFrom: "2026-08-01",
      name: "Missing Calendar Player",
    })
    expect(() => completeFromPreview({
      academyPlan: "weekday-3-day",
      agreedMonthlyFeePaise: 350_000,
      batch: "Weekday",
      effectiveFrom: "2026-08-01",
      idempotencyKey: "reject-missing-calendar",
      level: "Beginner",
      playerId,
    }, { coachId, createFeeReference: references, createId: ids, database, now: onboardingNow }))
      .toThrow(expect.objectContaining({ code: "SETUP_REQUIRED", field: "playerId" }))
    expect(database.select().from(schema.feeAgreements).where(eq(
      schema.feeAgreements.playerAccountId,
      playerId,
    )).all()).toHaveLength(0)
    expect(database.select().from(schema.financialCharges).where(eq(
      schema.financialCharges.playerAccountId,
      playerId,
    )).all()).toHaveLength(0)
  })

  it("rounds a partial joining-month fee to the nearest fifty rupees", () => {
    expect(calculateProratedSessionFee(350_000, 5, 12)).toBe(145_000)
    expect(calculateProratedSessionFee(255_000, 1, 2)).toBe(130_000)
    expect(calculateProratedSessionFee(350_000, 12, 12)).toBe(350_000)
    expect(calculateProratedSessionFee(350_000, 0, 12)).toBe(0)
    expect(() => calculateProratedSessionFee(350_000, 13, 12)).toThrow(
      "Invalid session fee proration.",
    )
  })

  it("bills a cross-month replacement in its original eligibility month", () => {
    const playerId = createAssessedPlayer({
      assignmentFrom: "2026-08-01",
      name: "Replacement Month Player",
      occurrences: [
        { date: "2026-08-30", status: "cancelled" },
        { date: "2026-09-02", replacementForDate: "2026-08-30" },
      ],
      trainingStartOn: "2026-08-30",
    })
    const terms = {
      academyPlan: "weekday-3-day",
      agreedMonthlyFeePaise: 350_000,
      batch: "Weekday",
      level: "Beginner",
      playerId,
    } as const
    const preview = finance.previewPlayerOnboardingFinance(terms, {
      coachId,
      database,
      now: new Date("2026-09-05T10:00:00+05:30"),
    })
    expect(preview.lines).toContainEqual(expect.objectContaining({
      denominator: 1,
      kind: "monthly_training",
      numerator: 1,
      period: "2026-08",
    }))
  })

  it("records pre-tracking months without charges", () => {
    const playerId = createAssessedPlayer({
      assignmentFrom: "2026-06-01",
      name: "Historical Tracking Player",
      occurrences: [
        { date: "2026-06-03" },
        { date: "2026-07-01" },
        { date: "2026-08-03" },
      ],
      trainingStartOn: "2026-06-03",
    })
    const terms = {
      academyPlan: "weekday-3-day",
      agreedMonthlyFeePaise: 350_000,
      batch: "Weekday",
      level: "Beginner",
      playerId,
    } as const
    const context = { coachId, createFeeReference: references, createId: ids, database, now: onboardingNow }
    const preview = finance.previewPlayerOnboardingFinance(terms, context)
    expect(preview.lines.filter(({ kind }) => kind === "before_tracking").map(({ period }) => period))
      .toEqual(["2026-06", "2026-07"])
    const completed = finance.completePlayerOnboardingFinance({
      ...terms,
      previewFingerprint: preview.fingerprint,
    }, context)
    expect(completed.createdMonthlyChargeIds).toHaveLength(1)
    expect(database.select().from(schema.financialCharges).where(and(
      eq(schema.financialCharges.playerAccountId, playerId),
      eq(schema.financialCharges.type, "monthly_training"),
    )).all().map(({ billingPeriod }) => billingPeriod)).toEqual(["2026-08"])
    const event = database.select().from(schema.financialAuditEvents).where(and(
      eq(schema.financialAuditEvents.entityId, playerId),
      eq(schema.financialAuditEvents.eventType, "historical_reconciled"),
    )).get()
    expect(JSON.parse(event?.metadata ?? "{}")).toMatchObject({
      beforeTrackingPeriods: ["2026-06", "2026-07"],
      operation: "onboarding_completed",
      trainingStartOn: "2026-06-03",
    })
  })

  it("issues every applicable elapsed month as one continuous timeline", () => {
    const playerId = createAssessedPlayer({
      assignmentFrom: "2026-08-01",
      name: "Elapsed Month Player",
      occurrences: [
        { date: "2026-08-03" },
        { date: "2026-09-02" },
        { date: "2026-10-02" },
      ],
      trainingStartOn: "2026-08-03",
    })
    const terms = {
      academyPlan: "weekday-3-day",
      agreedMonthlyFeePaise: 350_000,
      batch: "Weekday",
      level: "Beginner",
      playerId,
    } as const
    const context = {
      coachId,
      createFeeReference: references,
      createId: ids,
      database,
      now: new Date("2026-10-04T10:00:00+05:30"),
    }
    const preview = finance.previewPlayerOnboardingFinance(terms, context)
    expect(preview.lines.filter(({ kind }) => kind === "monthly_training").map(({ period }) => period))
      .toEqual(["2026-08", "2026-09", "2026-10"])
    expect(finance.completePlayerOnboardingFinance({
      ...terms,
      previewFingerprint: preview.fingerprint,
    }, context).createdMonthlyChargeIds).toHaveLength(3)
  })

  it("blocks an already prepared or voided historical month", () => {
    const issuedPlayerId = createAssessedPlayer({
      assignmentFrom: "2026-08-01",
      name: "Prepared Month Player",
      occurrences: [{ date: "2026-08-18" }],
      trainingStartOn: "2026-08-18",
    })
    database.insert(schema.financialCharges).values({
      billingPeriod: "2026-08",
      description: "Previously prepared monthly fee",
      dueDate: "2026-08-21",
      feeReference: "SMBA-HJKLMNPQ",
      id: ids(),
      issuedAt: onboardingNow,
      issuedByAccountId: coachId,
      originalAmountPaise: 350_000,
      playerAccountId: issuedPlayerId,
      type: "monthly_training",
    }).run()
    const issuedPreview = finance.previewPlayerOnboardingFinance({
      academyPlan: "weekday-3-day",
      agreedMonthlyFeePaise: 350_000,
      batch: "Weekday",
      level: "Beginner",
      playerId: issuedPlayerId,
    }, { coachId, database, now: onboardingNow })
    expect(issuedPreview.blockers).toContain(
      "Existing issued or voided charges conflict with this onboarding timeline.",
    )

    const voidedPlayerId = createAssessedPlayer({
      assignmentFrom: "2026-08-01",
      name: "Voided Month Player",
      occurrences: [{ date: "2026-08-18" }],
      trainingStartOn: "2026-08-18",
    })
    database.insert(schema.financialCharges).values({
      billingPeriod: "2026-08",
      description: "Voided historical monthly fee",
      dueDate: "2026-08-21",
      feeReference: "SMBA-JKLMNPQR",
      id: ids(),
      issuedAt: onboardingNow,
      issuedByAccountId: coachId,
      lifecycle: "void",
      originalAmountPaise: 350_000,
      playerAccountId: voidedPlayerId,
      recordRevision: 1,
      type: "monthly_training",
      voidedAt: onboardingNow,
      voidedByAccountId: coachId,
      voidReason: "Historical setup replaced offline",
    }).run()
    const voidedPreview = finance.previewPlayerOnboardingFinance({
      academyPlan: "weekday-3-day",
      agreedMonthlyFeePaise: 350_000,
      batch: "Weekday",
      level: "Beginner",
      playerId: voidedPlayerId,
    }, { coachId, database, now: onboardingNow })
    expect(voidedPreview.blockers).toContain(
      "Existing issued or voided charges conflict with this onboarding timeline.",
    )
  })

  it("rejects a preview when concessions or the academy date change before commit", () => {
    const concessionPlayerId = createAssessedPlayer({
      assignmentFrom: "2026-08-01",
      name: "Stale Concession Player",
      occurrences: [{ date: "2026-08-18" }, { date: "2026-08-25" }],
      trainingStartOn: "2026-08-18",
    })
    const concessionTerms = {
      academyPlan: "weekday-3-day",
      agreedMonthlyFeePaise: 350_000,
      batch: "Weekday",
      level: "Beginner",
      playerId: concessionPlayerId,
    } as const
    const concessionPreview = finance.previewPlayerOnboardingFinance(concessionTerms, {
      coachId,
      database,
      now: onboardingNow,
    })
    finance.createConcession({
      mode: "recurring",
      mutationId: "00000000-0000-4000-8000-000000000099",
      playerId: concessionPlayerId,
      reason: "Offline academy agreement",
      startsPeriod: "2026-08",
      value: 10_000,
      valueKind: "fixed",
    }, { coachId, createId: ids, database, now: onboardingNow })
    expect(() => finance.completePlayerOnboardingFinance({
      ...concessionTerms,
      previewFingerprint: concessionPreview.fingerprint,
    }, { coachId, createFeeReference: references, createId: ids, database, now: onboardingNow }))
      .toThrow(expect.objectContaining({ code: "CONFLICT" }))

    const midnightPlayerId = createAssessedPlayer({
      assignmentFrom: "2026-08-01",
      name: "Midnight Preview Player",
      occurrences: [{ date: "2026-08-31" }, { date: "2026-09-02" }],
      trainingStartOn: "2026-08-31",
    })
    const midnightTerms = { ...concessionTerms, playerId: midnightPlayerId }
    const beforeMidnight = new Date("2026-08-31T23:59:00+05:30")
    const afterMidnight = new Date("2026-09-01T00:01:00+05:30")
    const midnightPreview = finance.previewPlayerOnboardingFinance(midnightTerms, {
      coachId,
      database,
      now: beforeMidnight,
    })
    expect(() => finance.completePlayerOnboardingFinance({
      ...midnightTerms,
      previewFingerprint: midnightPreview.fingerprint,
    }, { coachId, createFeeReference: references, createId: ids, database, now: afterMidnight }))
      .toThrow(expect.objectContaining({ code: "CONFLICT" }))
  })
})

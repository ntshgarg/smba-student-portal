import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import BetterSqlite3 from "better-sqlite3"
import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-charge-view-round-trips-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "smba-test.db")

/*
 * Production speaks to libSQL over the network with the synchronous driver, so
 * every prepared statement is a blocking round trip, and the payment paths run
 * inside `immediate` transactions holding the academy's only write lock.
 * `loadChargeViews` costs four statements -- one `financial_charges` select
 * plus the three reads in `loadChargeRelations` -- for any non-empty id set,
 * which is the whole reason the money paths load one batch instead of calling
 * the single-charge `loadChargeView` wrapper per row.
 *
 * This counts the statements a real command issues rather than reading the
 * source, because the defect it guards against is not a particular call site:
 * it is any per-charge ledger read creeping back into a loop, however spelled.
 * Only the ledger reads are counted, so unrelated statement changes elsewhere
 * in these commands cannot make it fail.
 */
describe("finance charge view round trips", () => {
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let repository: typeof import("@/lib/finance/repository")
  let finance: typeof import("@/lib/finance/service")
  let documents: typeof import("@/lib/finance/documents")
  let records: typeof import("@/lib/finance/records")
  let domain: typeof import("@/lib/finance/domain")
  let schema: typeof import("@/lib/db/schema")

  const coachId = "00000000-0000-4000-8000-000000000001"
  const now = new Date("2026-08-20T10:00:00+05:30")
  const createdAt = new Date("2026-01-01T10:00:00+05:30")
  let nextId = 0
  const createId = () => `charge-view-${String(nextId += 1).padStart(5, "0")}`
  let nextSerial = 9_000
  let nextFeeReference = 0

  // `loadChargeViews` opens with this select and `loadChargeRelations` keys off
  // the rows it returns, so one occurrence is one ledger load whatever the batch
  // size -- and counting it ignores every other read these commands make.
  const LEDGER_LOAD = 'from "financial_charges" where "financial_charges"."id" in'

  const originalPrepare = BetterSqlite3.prototype.prepare

  function countLedgerLoads<T>(run: () => T) {
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
    return {
      ledgerLoads: statements.filter((sql) => sql.includes(LEDGER_LOAD)).length,
      statements: statements.length,
      value: value!,
    }
  }

  function createPlayer(label: string) {
    const playerId = `charge-view-player-${label}`
    database.insert(schema.accounts).values({
      id: playerId,
      fullName: `Charge View ${label}`,
      normalizedName: `charge view ${label.toLowerCase()}`,
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
    return playerId
  }

  // Distinct periods, because one issued monthly Charge per player per period is
  // a unique index (`financial_charges_one_monthly_period_idx`).
  function createCharges(playerId: string, periods: string[]) {
    return periods.map((period) => {
      const id = `${playerId}-${period}`
      database.insert(schema.financialCharges).values({
        id,
        feeReference: `SMBA-CV${String(nextFeeReference += 1).padStart(6, "0")}`,
        playerAccountId: playerId,
        feeAgreementId: `${playerId}-plan`,
        type: "monthly_training",
        billingPeriod: period,
        description: `Monthly training fee · ${period}`,
        originalAmountPaise: 100_000,
        currency: "INR",
        dueDate: `${period}-05`,
        lifecycle: "issued",
        recordRevision: 0,
        issuedByAccountId: coachId,
        issuedAt: new Date(`${period}-05T10:00:00+05:30`),
      }).run()
      return id
    })
  }

  function allocationsFor(chargeIds: string[]) {
    return chargeIds.map((chargeId) => ({
      chargeId,
      amountPaise: 100_000,
      expectedChargeRevision: 0,
    }))
  }

  // `hasAssignment` is the only gate between a fee agreement and monthly
  // preparation, and it needs nothing but an active series the player is
  // assigned to for the period; occurrences only matter to proration.
  const preparationSeriesId = "charge-view-preparation-series"
  let preparationSeriesCreated = false
  function addPreparationAssignment(playerId: string, label: string) {
    if (!preparationSeriesCreated) {
      database.insert(schema.sessionSeries).values({
        id: preparationSeriesId,
        title: "Beginner_Weekday_charge-view",
        programme: "Beginner",
        batch: "Weekday",
        venue: "SMBA Court",
        startsOn: "2026-01-01",
        endsOn: null,
        status: "active",
        createdByAccountId: coachId,
        createdAt,
      }).run()
      preparationSeriesCreated = true
    }
    database.insert(schema.sessionAssignments).values({
      id: `charge-view-assignment-${label}`,
      accountId: playerId,
      seriesId: preparationSeriesId,
      effectiveFrom: "2026-01-01",
      assignedByAccountId: coachId,
      assignedAt: createdAt,
    }).run()
  }

  let nextRefundReference = 0
  let nextMutation = 0
  const mutationId = () => (
    `00000000-0000-4000-8000-0000009${String(nextMutation += 1).padStart(5, "0")}`
  )

  beforeAll(async () => {
    schema = await import("@/lib/db/schema")
    finance = await import("@/lib/finance/service")
    repository = await import("@/lib/finance/repository")
    documents = await import("@/lib/finance/documents")
    records = await import("@/lib/finance/records")
    domain = await import("@/lib/finance/domain")
    const { prepareDatabase } = await import("@/lib/db/setup")
    database = prepareDatabase({ seed: true })
    finance.activateFinance({
      trackingMonth: "2026-08",
      idempotencyKey: "charge-view-round-trips-activation",
    }, { coachId, createId, database, now })
  })

  afterAll(() => {
    BetterSqlite3.prototype.prepare = originalPrepare
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  it("costs four statements for one charge and four for fifty", () => {
    const playerId = createPlayer("Batch")
    const chargeIds = createCharges(playerId, Array.from({ length: 50 }, (_, index) => {
      const month = index % 12
      return `${2020 + Math.floor(index / 12)}-${String(month + 1).padStart(2, "0")}`
    }))

    const one = countLedgerLoads(() => {
      repository.loadChargeViews(database, [chargeIds[0]], now)
    })
    const fifty = countLedgerLoads(() => {
      repository.loadChargeViews(database, chargeIds, now)
    })
    const fiftySingles = countLedgerLoads(() => {
      chargeIds.forEach((chargeId) => { repository.loadChargeView(database, chargeId, now) })
    })

    expect(one.statements).toBe(4)
    expect(fifty.statements).toBe(4)
    // The wrapper is a one-element delegation, so a loop over it pays the four
    // in full per charge. This is the ratio the batched call sites exist for.
    expect(fiftySingles.statements).toBe(200)
  })

  it("leaves a missing charge absent from the map and null from the wrapper", () => {
    expect(repository.loadChargeViews(database, ["no-such-charge"], now).has("no-such-charge"))
      .toBe(false)
    expect(repository.loadChargeView(database, "no-such-charge", now)).toBeNull()
  })

  it("does not read a ledger per allocation when recording a payment", () => {
    const twoPlayerId = createPlayer("TwoAllocations")
    const sixPlayerId = createPlayer("SixAllocations")
    const twoCharges = createCharges(twoPlayerId, ["2026-07", "2026-08"])
    const sixCharges = createCharges(
      sixPlayerId,
      ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"],
    )

    const forTwo = countLedgerLoads(() => {
      finance.recordAllocatedPayment({
        playerId: twoPlayerId,
        amountPaise: 200_000,
        receivedOn: "2026-08-10",
        method: "cash",
        allocations: allocationsFor(twoCharges),
        mutationId: "00000000-0000-4000-8000-000000000101",
      }, { coachId, createId, database, now })
    })
    const forSix = countLedgerLoads(() => {
      finance.recordAllocatedPayment({
        playerId: sixPlayerId,
        amountPaise: 600_000,
        receivedOn: "2026-08-10",
        method: "cash",
        allocations: allocationsFor(sixCharges),
        mutationId: "00000000-0000-4000-8000-000000000102",
      }, { coachId, createId, database, now })
    })

    // Validation reads the ledgers once for the whole allocation set and the
    // post-write projection reads them once more; three times as many
    // allocations must not cost three times as many ledger loads.
    expect(forTwo.ledgerLoads).toBe(2)
    expect(forSix.ledgerLoads).toBe(2)
  })

  it("does not read a ledger per charge when previewing an allocation", () => {
    const smallPlayerId = createPlayer("PreviewTwo")
    const largePlayerId = createPlayer("PreviewTwelve")
    createCharges(smallPlayerId, ["2026-07", "2026-08"])
    createCharges(largePlayerId, [
      "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02",
      "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08",
    ])

    const forTwo = countLedgerLoads(() => {
      finance.previewPaymentAllocations({
        playerId: smallPlayerId,
        amountPaise: 100_000,
      }, { coachId, database, now })
    })
    const forTwelve = countLedgerLoads(() => {
      finance.previewPaymentAllocations({
        playerId: largePlayerId,
        amountPaise: 100_000,
      }, { coachId, database, now })
    })

    // A player a year behind must cost the same preview as one a month behind.
    expect(forTwo.ledgerLoads).toBe(1)
    expect(forTwelve.ledgerLoads).toBe(1)
  })

  /*
   * Preparing a month is the read that most deserves this gate: it is the one
   * command whose work is proportional to the whole roster, and all of it runs
   * inside a single `immediate` transaction holding the academy's only write
   * lock. The per-candidate ledger read does not appear in the loop -- it is a
   * call frame down, inside the recurring-concession application -- so counting
   * statements is the only way to see it.
   */
  it("does not read a ledger per player when re-running a prepared month", () => {
    const enrol = (labels: string[]) => labels.map((label) => {
      const playerId = createPlayer(label)
      addPreparationAssignment(playerId, label)
      finance.createConcession({
        playerId,
        mode: "recurring",
        valueKind: "percentage",
        value: 1_000,
        startsPeriod: "2026-01",
        reason: `Sibling concession ${label}`,
        mutationId: mutationId(),
      }, { coachId, createId, database, now })
      return playerId
    })
    const prepare = (key: string) => finance.prepareMonthlyCharges({
      period: "2026-08",
      idempotencyKey: key,
    }, { coachId, createId, database, now })

    const smallCohort = enrol(["PrepareA1", "PrepareA2", "PrepareA3"])
    prepare("charge-view-prepare-small")
    const smallRerun = countLedgerLoads(() => prepare("charge-view-rerun-small"))

    const largeCohort = enrol([
      "PrepareB1", "PrepareB2", "PrepareB3", "PrepareB4", "PrepareB5",
      "PrepareB6", "PrepareB7", "PrepareB8", "PrepareB9",
    ])
    prepare("charge-view-prepare-large")
    const largeRerun = countLedgerLoads(() => prepare("charge-view-rerun-large"))

    // The loop really did run four times as often; only the reads are shared.
    expect(smallRerun.value.alreadyPrepared).toBe(smallCohort.length)
    expect(largeRerun.value.alreadyPrepared).toBe(smallCohort.length + largeCohort.length)
    expect(smallRerun.ledgerLoads).toBe(1)
    expect(largeRerun.ledgerLoads).toBe(1)

    // The batch is a read shortcut, not a change of outcome: every prepared
    // Charge still carries exactly one 10% concession credit and nothing else.
    const preparedPlayerIds = [...smallCohort, ...largeCohort]
    preparedPlayerIds.forEach((playerId) => {
      const charge = database.select().from(schema.financialCharges).where(and(
        eq(schema.financialCharges.playerAccountId, playerId),
        eq(schema.financialCharges.billingPeriod, "2026-08"),
      )).get()
      expect(charge?.originalAmountPaise).toBe(100_000)
      expect(database.select().from(schema.chargeAdjustments)
        .where(eq(schema.chargeAdjustments.chargeId, charge!.id)).all())
        .toEqual([expect.objectContaining({ kind: "concession_credit", amountPaise: 10_000 })])
      expect(repository.loadChargeView(database, charge!.id, now)?.outstandingPaise).toBe(90_000)
    })
  })

  /*
   * The refund replays and the reversal are money paths inside the same
   * `immediate` transaction, and a mid-term withdrawal refund is structurally
   * single-charge -- `reverseRefund` rejects anything else -- so the only shape
   * that can show the difference is a migrated pre-0017 refund, which is
   * allowed to span several allocations.
   */
  it("does not read a ledger per charge when replaying or reversing a refund", () => {
    const seedLegacyRefund = (label: string, periods: string[]) => {
      const playerId = createPlayer(label)
      const chargeIds = createCharges(playerId, periods)
      const payment = finance.recordAllocatedPayment({
        playerId,
        amountPaise: 100_000 * chargeIds.length,
        receivedOn: "2026-08-10",
        method: "cash",
        allocations: allocationsFor(chargeIds),
        mutationId: mutationId(),
      }, { coachId, createId, database, now })
      const allocationIds = payment.receipt.allocations.map(({ id }) => id)
      expect(allocationIds).toHaveLength(chargeIds.length)

      const refundMutationId = mutationId()
      const refundInput = {
        paymentId: payment.receipt.id,
        expectedPaymentRevision: 0,
        amountPaise: 10_000 * allocationIds.length,
        refundedOn: "2026-08-12",
        method: "upi" as const,
        allocations: allocationIds.map((paymentAllocationId) => ({
          paymentAllocationId,
          amountPaise: 10_000,
        })),
        mutationId: refundMutationId,
      }
      const refundId = `charge-view-legacy-refund-${label}`
      database.insert(schema.refunds).values({
        id: refundId,
        refundReference: `SMBA-RF-2026-9${String(nextRefundReference += 1).padStart(4, "0")}`,
        paymentId: payment.receipt.id,
        playerAccountId: playerId,
        purpose: "legacy_unclassified",
        withdrawalEffectiveOn: null,
        chargeAdjustmentId: null,
        amountPaise: refundInput.amountPaise,
        currency: "INR",
        refundedOn: refundInput.refundedOn,
        method: refundInput.method,
        externalReference: null,
        internalNote: null,
        lifecycle: "recorded",
        idempotencyKey: refundMutationId,
        // The service normalises before fingerprinting: allocations sorted by
        // payment allocation id, absent text as null.
        payloadFingerprint: domain.financialPayloadFingerprint({
          ...refundInput,
          allocations: [...refundInput.allocations].sort((left, right) => (
            left.paymentAllocationId.localeCompare(right.paymentAllocationId)
          )),
          externalReference: null,
          internalNote: null,
        }),
        recordRevision: 0,
        recordedByAccountId: coachId,
        recordedAt: now,
      }).run()
      allocationIds.forEach((paymentAllocationId, index) => {
        database.insert(schema.refundAllocations).values({
          id: `${refundId}-allocation-${index}`,
          refundId,
          paymentAllocationId,
          amountPaise: 10_000,
          createdAt: now,
        }).run()
      })
      return { chargeIds, refundId, refundInput }
    }

    const one = seedLegacyRefund("RefundOne", ["2024-01"])
    const six = seedLegacyRefund(
      "RefundSix",
      ["2024-02", "2024-03", "2024-04", "2024-05", "2024-06", "2024-07"],
    )

    const measure = (seeded: ReturnType<typeof seedLegacyRefund>) => {
      // A migrated pre-0017 payload has no withdrawal fields, and the legacy
      // replay branch returns before it would read any: same cast the
      // authentic-fingerprint test in finance-v2-service uses.
      const replay = countLedgerLoads(() => finance.recordRefund(
        seeded.refundInput as unknown as Parameters<typeof finance.recordRefund>[0],
        { coachId, createId, database, now },
      ))
      expect(replay.value.reused).toBe(true)
      expect(replay.value.charges).toHaveLength(seeded.chargeIds.length)

      const reversalMutationId = mutationId()
      const reversal = {
        refundId: seeded.refundId,
        expectedRefundRevision: 0,
        reason: "Recorded against the wrong receipt",
        mutationId: reversalMutationId,
      }
      const reversed = countLedgerLoads(() => finance.reverseRefund(
        reversal,
        { coachId, createId, database, now },
      ))
      expect(reversed.value.reused).toBe(false)
      expect(reversed.value.charges).toHaveLength(seeded.chargeIds.length)

      const reversalReplay = countLedgerLoads(() => finance.reverseRefund(
        reversal,
        { coachId, createId, database, now },
      ))
      expect(reversalReplay.value.reused).toBe(true)
      expect(reversalReplay.value.charges).toHaveLength(seeded.chargeIds.length)

      return {
        replay: replay.ledgerLoads,
        reversalReplay: reversalReplay.ledgerLoads,
        reversed: reversed.ledgerLoads,
      }
    }

    // Six refunded monthly fees must cost the same three ledger loads as one.
    expect(measure(one)).toEqual({ replay: 1, reversalReplay: 1, reversed: 1 })
    expect(measure(six)).toEqual({ replay: 1, reversalReplay: 1, reversed: 1 })
  })

  /*
   * The two read-only surfaces the same conversion touched. Neither holds the
   * write lock, but both are per-charge fan-outs a coach hits from a phone: the
   * statement over one player's whole history, the register over the roster.
   */
  it("does not read a ledger per charge in a statement or the fee register", () => {
    const onePlayerId = createPlayer("RegisterOne")
    const registerPeriod = "2019-02"
    createCharges(onePlayerId, ["2019-01"])
    const manyPlayerIds = ["RegisterA", "RegisterB", "RegisterC", "RegisterD", "RegisterE"]
      .map((label) => {
        const playerId = createPlayer(label)
        createCharges(playerId, [registerPeriod])
        return playerId
      })
    const statementPlayerId = createPlayer("StatementTwelve")
    createCharges(statementPlayerId, [
      "2022-01", "2022-02", "2022-03", "2022-04", "2022-05", "2022-06",
      "2022-07", "2022-08", "2022-09", "2022-10", "2022-11", "2022-12",
    ])

    const oneStatement = countLedgerLoads(() => documents.getPlayerFeeStatement(
      onePlayerId,
      { coachId, database, now },
    ))
    const twelveStatement = countLedgerLoads(() => documents.getPlayerFeeStatement(
      statementPlayerId,
      { coachId, database, now },
    ))
    expect(oneStatement.value?.charges).toHaveLength(1)
    expect(twelveStatement.value?.charges).toHaveLength(12)
    expect(oneStatement.ledgerLoads).toBe(1)
    expect(twelveStatement.ledgerLoads).toBe(1)

    const oneRow = countLedgerLoads(() => records.loadFeeRegister(
      database,
      { mode: "monthly", period: "2019-01", limit: 100 },
      now,
    ))
    const manyRows = countLedgerLoads(() => records.loadFeeRegister(
      database,
      { mode: "monthly", period: registerPeriod, limit: 100 },
      now,
    ))
    expect(oneRow.ledgerLoads).toBe(1)
    expect(manyRows.ledgerLoads).toBe(1)
    expect(manyRows.value.rows.filter((row) => (
      manyPlayerIds.includes(row.playerId)
    ))).toHaveLength(manyPlayerIds.length)
  })
})

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import BetterSqlite3 from "better-sqlite3"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-finance-activity-scope-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "smba-test.db")

/*
 * Production runs libSQL over the network, so what the head coach pays for here
 * is not the statement count -- that is nine either way -- but the rows those
 * statements drag back. The activity read used to `select()` the ledger tables
 * whole, and the CSV export repeats the entire read once per 100-row page
 * (`app/coach/financials/records/activity.csv/route.ts:59`), so opening the
 * Activity tab cost the size of the academy's whole financial history, once per
 * page. Neither call site sends a date range, so bounding the ledger reads to
 * one is not enough on its own: the page itself has to come out of the
 * database. This measures rows returned rather than reading the source, because
 * the defect is any unbounded read creeping back, however it is spelled.
 */
describe("financial activity read scope", () => {
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let records: typeof import("@/lib/finance/records")
  let schema: typeof import("@/lib/db/schema")

  const coachId = "00000000-0000-4000-8000-000000000001"
  const historyCount = 40
  const setupNow = new Date("2027-06-20T10:00:00+05:30")
  const originalPrepare = BetterSqlite3.prototype.prepare

  function addPlayer(id: string, fullName: string) {
    database.insert(schema.accounts).values({
      id,
      fullName,
      normalizedName: fullName.toLocaleLowerCase("en-IN"),
      requestedRole: "player",
      role: "player",
      approvalStatus: "approved",
      approvedAt: setupNow,
      approvedByAccountId: coachId,
      createdAt: setupNow,
      updatedAt: setupNow,
    }).run()
  }

  function addRecordedPayment(playerId: string, suffix: string, receivedOn: string) {
    const paymentId = `activity-scope-payment-${suffix}`
    database.insert(schema.payments).values({
      id: paymentId,
      playerAccountId: playerId,
      receiptReference: `SMBA-R-SCOPE-${suffix}`,
      amountPaise: 200_000,
      receivedOn,
      method: "upi",
      idempotencyKey: `activity-scope-key-${suffix}`,
      payloadFingerprint: `activity-scope-fingerprint-${suffix}`,
      recordedByAccountId: coachId,
      recordedAt: new Date(`${receivedOn}T10:00:00+05:30`),
    }).run()
    database.insert(schema.financialAuditEvents).values({
      id: `activity-scope-event-${suffix}`,
      actorAccountId: coachId,
      eventType: "payment_recorded",
      entityType: "payment",
      entityId: paymentId,
      occurredAt: new Date(`${receivedOn}T10:00:00+05:30`),
    }).run()
  }

  beforeAll(async () => {
    schema = await import("@/lib/db/schema")
    records = await import("@/lib/finance/records")
    const { prepareDatabase } = await import("@/lib/db/setup")
    database = prepareDatabase({ seed: true })

    // January is the history the June window must not pay for.
    Array.from({ length: historyCount }, (_, index) => index).forEach((index) => {
      const suffix = `history-${String(index).padStart(3, "0")}`
      const playerId = `activity-scope-player-${suffix}`
      addPlayer(playerId, `History ${suffix}`)
      addRecordedPayment(playerId, suffix, "2027-01-15")
    })

    addPlayer("activity-scope-player-recent", "Recent Payer")
    addRecordedPayment("activity-scope-player-recent", "recent", "2027-06-10")
  })

  afterAll(() => {
    BetterSqlite3.prototype.prepare = originalPrepare
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  function countRows<T>(run: () => T) {
    let rows = 0
    BetterSqlite3.prototype.prepare = function patched(this: BetterSqlite3.Database, ...args) {
      const statement = originalPrepare.apply(this, args as Parameters<typeof originalPrepare>)
      // Drizzle reads a joined select through `raw().all()` and a plain one
      // through `all()`; both land on this method, and both return one array
      // entry per row whichever shape the entry has.
      const counted = statement as unknown as { all: (...parameters: unknown[]) => unknown }
      const uncounted = counted.all.bind(counted)
      counted.all = (...parameters: unknown[]) => {
        const result = uncounted(...parameters)
        rows += Array.isArray(result) ? result.length : 0
        return result
      }
      return statement
    } as typeof originalPrepare
    try {
      return { result: run(), rows }
    } finally {
      BetterSqlite3.prototype.prepare = originalPrepare
    }
  }

  it("reads the ledger by the ids one month of events names, not by the table", () => {
    const { result, rows } = countRows(() => records.loadFinancialActivity(database, {
      from: "2027-06-01",
      to: "2027-06-30",
      limit: 50,
    }))

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      eventType: "payment_recorded",
      playerName: "Recent Payer",
      reference: "SMBA-R-SCOPE-recent",
      amountPaise: 200_000,
    })
    expect(result.items[0].actorName).not.toBe("Unknown coach")
    // June names one payment and two accounts. The whole-table form returned
    // every one of January's payments and every account on top of that, so it
    // could not have come in under the history count on its own.
    expect(rows).toBeLessThan(historyCount)
  })

  it("costs one page when no date range is given, which is what both call sites send", () => {
    const { result, rows } = countRows(() => records.loadFinancialActivity(database, {
      limit: 5,
    }))

    expect(result.items).toHaveLength(5)
    expect(result.nextCursor).toBe(result.items[4].id)
    // The Activity tab (`app/coach/financials/records/page.tsx`) and the CSV
    // export both leave `from`/`to` empty, so this is the default shape. Every
    // ledger row is named by an audit event when it is written, which is why
    // binding the lookups to the ids of an unbounded event read saves nothing:
    // the page has to be cut before anything else is read.
    expect(rows).toBeLessThan(historyCount)
  })

  it("pages by keyset in the same order the whole-window read produces", () => {
    const everything = records.loadFinancialActivity(database, { limit: 500 })
    const first = records.loadFinancialActivity(database, { limit: 3 })
    const second = records.loadFinancialActivity(database, {
      cursor: first.nextCursor ?? undefined,
      limit: 3,
    })

    expect(first.items.map((item) => item.id))
      .toEqual(everything.items.slice(0, 3).map((item) => item.id))
    expect(second.items.map((item) => item.id))
      .toEqual(everything.items.slice(3, 6).map((item) => item.id))
    expect(() => records.loadFinancialActivity(database, {
      cursor: "activity-scope-event-never-written",
      limit: 3,
    })).toThrow(records.FinanceRecordsCursorError)
  })

  it("still searches the whole window on the fields only the ledger rows carry", () => {
    // A receipt reference lives on the payment, not the audit event, so search
    // cannot be pushed into the `where` clause and this path keeps building the
    // window before cutting the page.
    const found = records.loadFinancialActivity(database, {
      limit: 50,
      query: "smba-r-scope-recent",
    })

    expect(found.items.map((item) => item.reference)).toEqual(["SMBA-R-SCOPE-recent"])
    expect(records.loadFinancialActivity(database, {
      limit: 50,
      query: "Recent Payer",
    }).items).toHaveLength(1)
  })
})

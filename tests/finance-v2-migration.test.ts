import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { afterEach, describe, expect, it } from "vitest"

const disposableDirectories: string[] = []

function makeDirectory(prefix: string) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  disposableDirectories.push(directory)
  return directory
}

function phaseOneMigrations(source: string, destination: string) {
  fs.mkdirSync(path.join(destination, "meta"), { recursive: true })
  const journal = JSON.parse(
    fs.readFileSync(path.join(source, "meta", "_journal.json"), "utf8"),
  ) as { entries: Array<{ tag: string }> } & Record<string, unknown>
  const entries = journal.entries.filter(({ tag }) => tag <= "0011_finance_v1")
  entries.forEach(({ tag }) => {
    fs.copyFileSync(path.join(source, `${tag}.sql`), path.join(destination, `${tag}.sql`))
  })
  fs.writeFileSync(
    path.join(destination, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries }, null, 2),
  )
}

afterEach(() => {
  while (disposableDirectories.length) {
    fs.rmSync(disposableDirectories.pop()!, { force: true, recursive: true })
  }
})

describe("Financials V2 migration", () => {
  it("backfills one immutable receipt and allocation per V1 payment and remains idempotent", () => {
    const temporaryDirectory = makeDirectory("smba-finance-v2-migration-")
    const phaseOneDirectory = path.join(temporaryDirectory, "v1-migrations")
    const fullMigrationsDirectory = path.resolve(process.cwd(), "drizzle")
    phaseOneMigrations(fullMigrationsDirectory, phaseOneDirectory)

    const sqlite = new Database(path.join(temporaryDirectory, "migration.db"))
    sqlite.pragma("foreign_keys = ON")
    const database = drizzle(sqlite)
    migrate(database, { migrationsFolder: phaseOneDirectory })

    const approvedAt = Date.parse("2025-12-01T10:00:00+05:30")
    sqlite.prepare(`
      insert into accounts (
        id, full_name, normalized_name, requested_role, role, approval_status,
        approved_at, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "migration-coach", "Migration Coach", "migration coach", "coach", "coach",
      "approved", approvedAt, approvedAt, approvedAt,
    )
    sqlite.prepare(`
      insert into accounts (
        id, full_name, normalized_name, requested_role, role, approval_status,
        approved_at, approved_by_account_id, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "migration-player", "Migration Player", "migration player", "player", "player",
      "approved", approvedAt, "migration-coach", approvedAt, approvedAt,
    )

    const insertCharge = sqlite.prepare(`
      insert into financial_charges (
        id, fee_reference, player_account_id, type, billing_period, description,
        original_amount_paise, currency, due_date, lifecycle, record_revision,
        issued_by_account_id, issued_at
      ) values (?, ?, ?, ?, ?, ?, ?, 'INR', ?, 'issued', 0, ?, ?)
    `)
    insertCharge.run(
      "migration-charge-2025", "SMBA-2K4M6P8Q", "migration-player", "monthly_training",
      "2025-12", "December training fee", 100_000, "2025-12-05", "migration-coach",
      Date.parse("2025-12-01T10:00:00+05:30"),
    )
    insertCharge.run(
      "migration-charge-2026-a", "SMBA-3K5M7P9Q", "migration-player", "monthly_training",
      "2026-01", "January training fee", 120_000, "2026-01-05", "migration-coach",
      Date.parse("2026-01-01T10:00:00+05:30"),
    )
    insertCharge.run(
      "migration-charge-2026-b", "SMBA-4K6M8P2Q", "migration-player", "monthly_training",
      "2026-02", "February training fee", 130_000, "2026-02-05", "migration-coach",
      Date.parse("2026-02-01T10:00:00+05:30"),
    )

    const insertPayment = sqlite.prepare(`
      insert into payments (
        id, charge_id, player_account_id, amount_paise, currency, received_on, method,
        lifecycle, idempotency_key, recorded_by_account_id, recorded_at
      ) values (?, ?, ?, ?, 'INR', ?, 'upi', 'recorded', ?, ?, ?)
    `)
    insertPayment.run(
      "legacy-payment-2025", "migration-charge-2025", "migration-player", 100_000,
      "2025-12-31", "legacy-payment-key-2025", "migration-coach",
      Date.parse("2025-12-31T10:00:00+05:30"),
    )
    // Insert in reverse chronological order to verify that references follow the
    // migration's stable received-date ordering, not physical insertion order.
    insertPayment.run(
      "legacy-payment-2026-b", "migration-charge-2026-b", "migration-player", 130_000,
      "2026-02-03", "legacy-payment-key-2026-b", "migration-coach",
      Date.parse("2026-02-03T10:00:00+05:30"),
    )
    insertPayment.run(
      "legacy-payment-2026-a", "migration-charge-2026-a", "migration-player", 120_000,
      "2026-01-03", "legacy-payment-key-2026-a", "migration-coach",
      Date.parse("2026-01-03T10:00:00+05:30"),
    )

    migrate(database, { migrationsFolder: fullMigrationsDirectory })

    const receipts = sqlite.prepare(`
      select id, receipt_reference as receiptReference, payload_fingerprint as fingerprint,
        record_revision as revision
      from payments
      order by received_on, id
    `).all() as Array<{
      id: string
      receiptReference: string
      fingerprint: string
      revision: number
    }>
    expect(receipts).toEqual([
      {
        id: "legacy-payment-2025",
        receiptReference: "SMBA-R-2025-00001",
        fingerprint: "phase1:legacy-payment-2025",
        revision: 0,
      },
      {
        id: "legacy-payment-2026-a",
        receiptReference: "SMBA-R-2026-00001",
        fingerprint: "phase1:legacy-payment-2026-a",
        revision: 0,
      },
      {
        id: "legacy-payment-2026-b",
        receiptReference: "SMBA-R-2026-00002",
        fingerprint: "phase1:legacy-payment-2026-b",
        revision: 0,
      },
    ])

    const allocations = sqlite.prepare(`
      select payment_id as paymentId, charge_id as chargeId, amount_paise as amountPaise
      from payment_allocations
      order by payment_id
    `).all()
    expect(allocations).toEqual([
      {
        paymentId: "legacy-payment-2025",
        chargeId: "migration-charge-2025",
        amountPaise: 100_000,
      },
      {
        paymentId: "legacy-payment-2026-a",
        chargeId: "migration-charge-2026-a",
        amountPaise: 120_000,
      },
      {
        paymentId: "legacy-payment-2026-b",
        chargeId: "migration-charge-2026-b",
        amountPaise: 130_000,
      },
    ])
    expect(sqlite.prepare(`
      select kind, year, last_value as lastValue
      from finance_reference_sequences
      order by year
    `).all()).toEqual([
      { kind: "receipt", year: 2025, lastValue: 1 },
      { kind: "receipt", year: 2026, lastValue: 2 },
    ])
    expect(sqlite.pragma("foreign_key_check")).toEqual([])
    expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok")

    migrate(database, { migrationsFolder: fullMigrationsDirectory })
    expect(sqlite.prepare("select count(*) as count from payments").get()).toEqual({ count: 3 })
    expect(sqlite.prepare("select count(*) as count from payment_allocations").get())
      .toEqual({ count: 3 })
    expect(sqlite.prepare("select count(*) as count from finance_reference_sequences").get())
      .toEqual({ count: 2 })
    sqlite.close()
  })
})

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

function copyMigrationsThrough(source: string, destination: string, finalTag: string) {
  fs.mkdirSync(path.join(destination, "meta"), { recursive: true })
  const journal = JSON.parse(
    fs.readFileSync(path.join(source, "meta", "_journal.json"), "utf8"),
  ) as { entries: Array<{ tag: string }> } & Record<string, unknown>
  const entries = journal.entries.filter(({ tag }) => tag <= finalTag)
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

describe("mid-term withdrawal refund migration", () => {
  it("preserves existing refunds as unclassified history without inventing credits", () => {
    const temporaryDirectory = makeDirectory("smba-withdrawal-refund-migration-")
    const previousMigrations = path.join(temporaryDirectory, "through-0016")
    const fullMigrations = path.resolve(process.cwd(), "drizzle")
    copyMigrationsThrough(fullMigrations, previousMigrations, "0016_registration_request_idempotency")

    const sqlite = new Database(path.join(temporaryDirectory, "migration.db"))
    sqlite.pragma("foreign_keys = ON")
    const database = drizzle(sqlite)
    migrate(database, { migrationsFolder: previousMigrations })

    const recordedAt = Date.parse("2026-08-10T10:00:00+05:30")
    sqlite.prepare(`
      insert into accounts (
        id, full_name, normalized_name, requested_role, role, approval_status,
        approved_at, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "refund-migration-coach", "Migration Coach", "migration coach", "coach", "coach",
      "approved", recordedAt, recordedAt, recordedAt,
    )
    sqlite.prepare(`
      insert into accounts (
        id, full_name, normalized_name, requested_role, role, approval_status,
        approved_at, approved_by_account_id, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "refund-migration-player", "Migration Player", "migration player", "player", "player",
      "approved", recordedAt, "refund-migration-coach", recordedAt, recordedAt,
    )
    sqlite.prepare(`
      insert into financial_charges (
        id, fee_reference, player_account_id, type, billing_period, description,
        original_amount_paise, currency, due_date, lifecycle, record_revision,
        issued_by_account_id, issued_at
      ) values (?, ?, ?, ?, ?, ?, ?, 'INR', ?, 'issued', 2, ?, ?)
    `).run(
      "refund-migration-charge", "SMBA-2K4M6P8Q", "refund-migration-player",
      "monthly_training", "2026-08", "August training fee", 350_000, "2026-08-05",
      "refund-migration-coach", recordedAt,
    )
    sqlite.prepare(`
      insert into payments (
        id, player_account_id, receipt_reference, amount_paise, currency, received_on,
        method, lifecycle, idempotency_key, payload_fingerprint, record_revision,
        recorded_by_account_id, recorded_at
      ) values (?, ?, ?, ?, 'INR', ?, 'upi', 'recorded', ?, ?, 1, ?, ?)
    `).run(
      "refund-migration-payment", "refund-migration-player", "SMBA-R-2026-00001",
      350_000, "2026-08-05", "refund-payment-key", "refund-payment-fingerprint",
      "refund-migration-coach", recordedAt,
    )
    sqlite.prepare(`
      insert into payment_allocations (
        id, payment_id, charge_id, amount_paise, created_by_account_id, created_at
      ) values (?, ?, ?, ?, ?, ?)
    `).run(
      "refund-migration-payment-allocation", "refund-migration-payment",
      "refund-migration-charge", 350_000, "refund-migration-coach", recordedAt,
    )
    sqlite.prepare(`
      insert into refunds (
        id, refund_reference, payment_id, player_account_id, amount_paise, currency,
        refunded_on, method, lifecycle, idempotency_key, payload_fingerprint,
        record_revision, recorded_by_account_id, recorded_at
      ) values (?, ?, ?, ?, ?, 'INR', ?, 'upi', 'recorded', ?, ?, 0, ?, ?)
    `).run(
      "refund-migration-refund", "SMBA-RF-2026-00001", "refund-migration-payment",
      "refund-migration-player", 50_000, "2026-08-10", "refund-mutation-key",
      "legacy-refund-fingerprint", "refund-migration-coach", recordedAt,
    )
    sqlite.prepare(`
      insert into refund_allocations (
        id, refund_id, payment_allocation_id, amount_paise, created_at
      ) values (?, ?, ?, ?, ?)
    `).run(
      "refund-migration-refund-allocation", "refund-migration-refund",
      "refund-migration-payment-allocation", 50_000, recordedAt,
    )

    migrate(database, { migrationsFolder: fullMigrations })

    expect(sqlite.prepare(`
      select purpose, withdrawal_effective_on as withdrawalEffectiveOn,
        charge_adjustment_id as chargeAdjustmentId
      from refunds where id = 'refund-migration-refund'
    `).get()).toEqual({
      purpose: "legacy_unclassified",
      withdrawalEffectiveOn: null,
      chargeAdjustmentId: null,
    })
    expect(sqlite.prepare("select count(*) as count from charge_adjustments").get())
      .toEqual({ count: 0 })
    expect(sqlite.prepare("select count(*) as count from refunds").get()).toEqual({ count: 1 })
    expect(sqlite.prepare("select count(*) as count from refund_allocations").get())
      .toEqual({ count: 1 })
    expect(sqlite.pragma("foreign_key_check")).toEqual([])
    expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok")

    migrate(database, { migrationsFolder: fullMigrations })
    expect(sqlite.prepare("select count(*) as count from refunds").get()).toEqual({ count: 1 })
    sqlite.close()
  })
})

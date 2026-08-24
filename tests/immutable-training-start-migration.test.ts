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

function migrationsThrough(source: string, destination: string, lastTag: string) {
  fs.mkdirSync(path.join(destination, "meta"), { recursive: true })
  const journal = JSON.parse(
    fs.readFileSync(path.join(source, "meta", "_journal.json"), "utf8"),
  ) as { entries: Array<{ tag: string }> } & Record<string, unknown>
  const entries = journal.entries.filter(({ tag }) => tag <= lastTag)
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

describe("immutable training-start migration", () => {
  it("converts legacy instants into IST dates, preserves stages and remains idempotent", () => {
    const temporaryDirectory = makeDirectory("smba-training-start-migration-")
    const beforeDirectory = path.join(temporaryDirectory, "before-migrations")
    const fullMigrationsDirectory = path.resolve(process.cwd(), "drizzle")
    migrationsThrough(fullMigrationsDirectory, beforeDirectory, "0025_operational_events")

    const sqlite = new Database(path.join(temporaryDirectory, "migration.db"))
    sqlite.pragma("foreign_keys = ON")
    const database = drizzle(sqlite)
    migrate(database, { migrationsFolder: beforeDirectory })

    const approvedAt = Date.parse("2026-08-01T10:00:00+05:30")
    const createdAt = Date.parse("2026-07-31T10:00:00+05:30")
    const insertAccount = sqlite.prepare(`
      insert into accounts (
        id, full_name, normalized_name, requested_role, role, approval_status,
        approved_at, approved_by_account_id, created_at, updated_at
      ) values (?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?)
    `)
    insertAccount.run(
      "migration-coach", "Migration Coach", "migration coach", "coach", "coach",
      approvedAt, null, createdAt, approvedAt,
    )
    insertAccount.run(
      "completed-player", "Completed Player", "completed player", "player", "player",
      approvedAt, "migration-coach", createdAt, approvedAt,
    )
    insertAccount.run(
      "assessment-player", "Assessment Player", "assessment player", "player", "player",
      approvedAt, "migration-coach", createdAt, approvedAt,
    )

    const insertEnrollment = sqlite.prepare(`
      insert into player_enrollments (
        account_id, level, batch, academy_plan, status, joined_at, record_revision, updated_at
      ) values (?, 'Beginner', 'Weekday', 'weekday-3-day', 'active', ?, 3, ?)
    `)
    // 18:29 UTC is still 1 August in India; 18:31 UTC is 2 August.
    insertEnrollment.run(
      "completed-player",
      Date.parse("2026-08-01T18:29:00.000Z"),
      approvedAt,
    )
    insertEnrollment.run(
      "assessment-player",
      Date.parse("2026-08-01T18:31:00.000Z"),
      approvedAt,
    )

    sqlite.prepare(`
      insert into session_series (
        id, title, programme, batch, venue, starts_on, ends_on, status,
        created_by_account_id, created_at
      ) values (
        'migration-series', 'Migration series', 'Beginner', 'Weekday', 'SMBA Court',
        '2026-08-01', null, 'active', 'migration-coach', ?
      )
    `).run(approvedAt)
    sqlite.prepare(`
      insert into session_assignments (
        id, account_id, series_id, effective_from, effective_to,
        assigned_by_account_id, assigned_at
      ) values (
        'migration-assignment', 'completed-player', 'migration-series',
        '2026-08-01', null, 'migration-coach', ?
      )
    `).run(approvedAt)
    const feePlanCreatedAt = Date.parse("2026-08-03T10:00:00+05:30")
    sqlite.prepare(`
      insert into fee_agreements (
        id, player_account_id, academy_plan, level, batch, agreed_monthly_fee_paise,
        currency, monthly_due_day, effective_from, effective_to, status, record_revision,
        created_by_account_id, created_at, updated_by_account_id, updated_at
      ) values (
        'migration-plan', 'completed-player', 'weekday-3-day', 'Beginner', 'Weekday',
        350000, 'INR', 5, '2026-08-01', null, 'active', 0,
        'migration-coach', ?, 'migration-coach', ?
      )
    `).run(feePlanCreatedAt, feePlanCreatedAt)

    migrate(database, { migrationsFolder: fullMigrationsDirectory })

    const rows = sqlite.prepare(`
      select account_id as accountId, training_start_on as trainingStartOn,
        training_start_confirmed_at as confirmedAt,
        training_start_confirmed_by_account_id as confirmedBy,
        onboarding_completed_at as completedAt,
        onboarding_completed_by_account_id as completedBy,
        record_revision as recordRevision
      from player_enrollments
      order by account_id
    `).all()
    expect(rows).toEqual([
      {
        accountId: "assessment-player",
        completedAt: null,
        completedBy: null,
        confirmedAt: approvedAt,
        confirmedBy: "migration-coach",
        recordRevision: 3,
        trainingStartOn: "2026-08-02",
      },
      {
        accountId: "completed-player",
        completedAt: feePlanCreatedAt,
        completedBy: "migration-coach",
        confirmedAt: approvedAt,
        confirmedBy: "migration-coach",
        recordRevision: 3,
        trainingStartOn: "2026-08-01",
      },
    ])
    expect(() => sqlite.prepare(`
      update player_enrollments set training_start_on = '2026-02-31'
      where account_id = 'assessment-player'
    `).run()).toThrow()
    expect(sqlite.pragma("foreign_key_check")).toEqual([])
    expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok")

    migrate(database, { migrationsFolder: fullMigrationsDirectory })
    expect(sqlite.prepare(`
      select account_id as accountId, training_start_on as trainingStartOn,
        onboarding_completed_at as completedAt, record_revision as recordRevision
      from player_enrollments order by account_id
    `).all()).toEqual([
      {
        accountId: "assessment-player",
        completedAt: null,
        recordRevision: 3,
        trainingStartOn: "2026-08-02",
      },
      {
        accountId: "completed-player",
        completedAt: feePlanCreatedAt,
        recordRevision: 3,
        trainingStartOn: "2026-08-01",
      },
    ])
    sqlite.close()
  })
})

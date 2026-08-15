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

describe("attendance and session integrity migration", () => {
  it("preserves valid attendance and rejects invalid choices or reused evidence", () => {
    const temporaryDirectory = makeDirectory("smba-attendance-integrity-")
    const previousMigrations = path.join(temporaryDirectory, "through-0017")
    const fullMigrations = path.resolve(process.cwd(), "drizzle")
    copyMigrationsThrough(
      fullMigrations,
      previousMigrations,
      "0017_mid_term_withdrawal_refunds",
    )

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
      "integrity-coach", "Integrity Coach", "integrity coach", "coach", "coach",
      "approved", recordedAt, recordedAt, recordedAt,
    )
    sqlite.prepare(`
      insert into accounts (
        id, full_name, normalized_name, requested_role, role, approval_status,
        approved_at, approved_by_account_id, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "integrity-player", "Integrity Player", "integrity player", "player", "player",
      "approved", recordedAt, "integrity-coach", recordedAt, recordedAt,
    )
    for (const [id, name] of [
      ["legacy-exact-player", "Legacy Exact Player"],
      ["legacy-ambiguous-player", "Legacy Ambiguous Player"],
    ]) {
      sqlite.prepare(`
        insert into accounts (
          id, full_name, normalized_name, requested_role, role, approval_status,
          approved_at, approved_by_account_id, created_at, updated_at
        ) values (?, ?, ?, 'player', 'player', 'approved', ?, 'integrity-coach', ?, ?)
      `).run(id, name, name.toLowerCase(), recordedAt, recordedAt, recordedAt)
    }
    sqlite.prepare(`
      insert into session_series (
        id, title, programme, batch, venue, starts_on, ends_on, status,
        created_by_account_id, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(
      "integrity-series", "Beginner · Weekday", "Beginner", "Weekday", "SMBA Court",
      "2026-08-01", "2026-08-31", "integrity-coach", recordedAt,
    )
    sqlite.prepare(`
      insert into session_series (
        id, title, programme, batch, venue, starts_on, ends_on, status,
        created_by_account_id, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(
      "integrity-series-two", "Intermediate · Weekday", "Intermediate", "Weekday",
      "SMBA Court 2", "2026-08-01", "2026-08-31", "integrity-coach", recordedAt,
    )
    const insertOccurrence = sqlite.prepare(`
      insert into session_occurrences (
        id, series_id, occurrence_date, starts_at, duration_minutes, venue,
        status, replacement_for_occurrence_id, created_at
      ) values (?, 'integrity-series', ?, ?, 60, 'SMBA Court', 'scheduled', ?, ?)
    `)
    insertOccurrence.run("source-one", "2026-08-01", recordedAt, null, recordedAt)
    insertOccurrence.run("source-two", "2026-08-02", recordedAt, null, recordedAt)
    insertOccurrence.run("completion", "2026-08-03", recordedAt, null, recordedAt)
    insertOccurrence.run("legacy-exact-source", "2026-08-08", recordedAt, null, recordedAt)
    insertOccurrence.run("legacy-exact-completion", "2026-08-09", recordedAt, null, recordedAt)
    insertOccurrence.run("legacy-ambiguous-source", "2026-08-10", recordedAt, null, recordedAt)
    insertOccurrence.run("legacy-ambiguous-completion-one", "2026-08-11", recordedAt, null, recordedAt)
    insertOccurrence.run("legacy-unverified-source", "2026-08-12", recordedAt, null, recordedAt)
    insertOccurrence.run("legacy-unverified-completion", "2026-08-13", recordedAt, null, recordedAt)
    sqlite.prepare(`
      insert into session_occurrences (
        id, series_id, occurrence_date, starts_at, duration_minutes, venue,
        status, replacement_for_occurrence_id, created_at
      ) values (?, 'integrity-series-two', ?, ?, 60, 'SMBA Court 2', 'scheduled', null, ?)
    `).run("legacy-ambiguous-completion-two", "2026-08-11", recordedAt, recordedAt)
    sqlite.prepare(`
      insert into session_attendance_records (
        id, account_id, occurrence_id, choice, marked_by_account_id, created_at, updated_at
      ) values (?, ?, ?, 'present', ?, ?, ?)
    `).run(
      "valid-attendance", "integrity-player", "completion", "integrity-coach",
      recordedAt, recordedAt,
    )
    sqlite.prepare(`
      insert into session_attendance_records (
        id, account_id, occurrence_id, choice, marked_by_account_id, created_at, updated_at
      ) values (?, ?, ?, 'late', ?, ?, ?)
    `).run(
      "invalid-attendance", "integrity-player", "source-one", "integrity-coach",
      recordedAt, recordedAt,
    )
    sqlite.prepare(`
      insert into session_attendance_records (
        id, account_id, occurrence_id, choice, marked_by_account_id, created_at, updated_at
      ) values (?, ?, ?, 'late', ?, ?, ?)
    `).run(
      "legacy-unverified-attendance", "integrity-player", "legacy-unverified-completion",
      "integrity-coach", recordedAt, recordedAt,
    )
    const insertPresentAttendance = sqlite.prepare(`
      insert into session_attendance_records (
        id, account_id, occurrence_id, choice, marked_by_account_id, created_at, updated_at
      ) values (?, ?, ?, 'present', 'integrity-coach', ?, ?)
    `)
    insertPresentAttendance.run(
      "legacy-exact-attendance",
      "legacy-exact-player",
      "legacy-exact-completion",
      recordedAt,
      recordedAt,
    )
    insertPresentAttendance.run(
      "legacy-ambiguous-attendance-one",
      "legacy-ambiguous-player",
      "legacy-ambiguous-completion-one",
      recordedAt,
      recordedAt,
    )
    insertPresentAttendance.run(
      "legacy-ambiguous-attendance-two",
      "legacy-ambiguous-player",
      "legacy-ambiguous-completion-two",
      recordedAt,
      recordedAt,
    )
    insertOccurrence.run(
      "legacy-replacement-one",
      "2026-08-04",
      recordedAt,
      "source-one",
      recordedAt,
    )
    insertOccurrence.run(
      "legacy-replacement-two",
      "2026-08-05",
      recordedAt,
      "source-one",
      recordedAt,
    )
    const insertAdjustment = sqlite.prepare(`
      insert into attendance_adjustments (
        id, type, player_account_id, source_occurrence_id, completed_on,
        completion_occurrence_id, published_by_account_id, published_at
      ) values (?, 'makeup', 'integrity-player', ?, '2026-08-03', 'completion',
        'integrity-coach', ?)
    `)
    insertAdjustment.run("adjustment-one", "source-one", recordedAt)
    insertAdjustment.run("adjustment-two", "source-two", recordedAt)
    const insertLegacyAdjustment = sqlite.prepare(`
      insert into attendance_adjustments (
        id, type, player_account_id, source_occurrence_id, completed_on,
        completion_occurrence_id, published_by_account_id, published_at
      ) values (?, 'makeup', ?, ?, ?, null, 'integrity-coach', ?)
    `)
    insertLegacyAdjustment.run(
      "legacy-exact-adjustment",
      "legacy-exact-player",
      "legacy-exact-source",
      "2026-08-09",
      recordedAt,
    )
    insertLegacyAdjustment.run(
      "legacy-ambiguous-adjustment",
      "legacy-ambiguous-player",
      "legacy-ambiguous-source",
      "2026-08-11",
      recordedAt,
    )
    sqlite.prepare(`
      insert into attendance_adjustments (
        id, type, player_account_id, source_occurrence_id, completed_on,
        completion_occurrence_id, published_by_account_id, published_at
      ) values (?, 'makeup', 'integrity-player', ?, ?, ?, 'integrity-coach', ?)
    `).run(
      "legacy-unverified-adjustment",
      "legacy-unverified-source",
      "2026-08-13",
      "legacy-unverified-completion",
      recordedAt,
    )

    migrate(database, { migrationsFolder: fullMigrations })

    expect(sqlite.prepare(`
      select choice from session_attendance_records where id = 'valid-attendance'
    `).get()).toEqual({ choice: "present" })
    expect(sqlite.prepare(`
      select choice from session_attendance_records where id = 'invalid-attendance'
    `).get()).toEqual({ choice: "cleared" })
    expect(sqlite.prepare(`
      select choice from session_attendance_records where id = 'legacy-unverified-attendance'
    `).get()).toEqual({ choice: "cleared" })
    expect(() => sqlite.prepare(`
      update session_attendance_records set choice = 'late' where id = 'valid-attendance'
    `).run()).toThrow(/session_attendance_choice_check/u)

    expect(sqlite.prepare(`
      select id, voided_at as voidedAt from attendance_adjustments
      where id in ('adjustment-one', 'adjustment-two') order by id
    `).all()).toEqual([
      { id: "adjustment-one", voidedAt: null },
      { id: "adjustment-two", voidedAt: recordedAt },
    ])
    expect(() => insertAdjustment.run(
      "adjustment-three",
      "source-two",
      recordedAt,
    )).toThrow(/UNIQUE constraint failed/u)
    expect(sqlite.prepare(`
      select completion_occurrence_id as completionOccurrenceId,
        review_required_at as reviewRequiredAt
      from attendance_adjustments where id = 'legacy-exact-adjustment'
    `).get()).toEqual({
      completionOccurrenceId: "legacy-exact-completion",
      reviewRequiredAt: null,
    })
    expect(sqlite.prepare(`
      select completion_occurrence_id as completionOccurrenceId,
        review_required_at as reviewRequiredAt
      from attendance_adjustments where id = 'legacy-unverified-adjustment'
    `).get()).toEqual({
      completionOccurrenceId: "legacy-unverified-completion",
      reviewRequiredAt: recordedAt,
    })
    expect(sqlite.prepare(`
      select completion_occurrence_id as completionOccurrenceId,
        review_required_at as reviewRequiredAt
      from attendance_adjustments where id = 'legacy-ambiguous-adjustment'
    `).get()).toEqual({
      completionOccurrenceId: null,
      reviewRequiredAt: recordedAt,
    })

    expect(sqlite.prepare(`
      select id, status from session_occurrences
      where replacement_for_occurrence_id = 'source-one' order by id
    `).all()).toEqual([
      { id: "legacy-replacement-one", status: "scheduled" },
      { id: "legacy-replacement-two", status: "cancelled" },
    ])
    expect(() => insertOccurrence.run(
      "replacement-three",
      "2026-08-06",
      recordedAt,
      "source-one",
      recordedAt,
    )).toThrow(/UNIQUE constraint failed/u)

    expect(sqlite.pragma("foreign_key_check")).toEqual([])
    expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok")
    sqlite.close()
  })

  it("reconciles legacy evidence when upgrading an already-0018 database", () => {
    const temporaryDirectory = makeDirectory("smba-attendance-evidence-review-")
    const previousMigrations = path.join(temporaryDirectory, "through-0018")
    const fullMigrations = path.resolve(process.cwd(), "drizzle")
    copyMigrationsThrough(
      fullMigrations,
      previousMigrations,
      "0018_attendance_session_integrity",
    )

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
      "review-coach", "Review Coach", "review coach", "coach", "coach",
      "approved", recordedAt, recordedAt, recordedAt,
    )
    sqlite.prepare(`
      insert into accounts (
        id, full_name, normalized_name, requested_role, role, approval_status,
        approved_at, approved_by_account_id, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "review-player", "Review Player", "review player", "player", "player",
      "approved", recordedAt, "review-coach", recordedAt, recordedAt,
    )
    sqlite.prepare(`
      insert into session_series (
        id, title, programme, batch, venue, starts_on, ends_on, status,
        created_by_account_id, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(
      "review-series", "Review series", "Beginner", "Weekday", "SMBA Court",
      "2026-08-01", "2026-08-31", "review-coach", recordedAt,
    )
    const insertOccurrence = sqlite.prepare(`
      insert into session_occurrences (
        id, series_id, occurrence_date, starts_at, duration_minutes, venue,
        status, replacement_for_occurrence_id, created_at
      ) values (?, 'review-series', ?, ?, 60, 'SMBA Court', 'scheduled', null, ?)
    `)
    insertOccurrence.run("review-source-one", "2026-08-01", recordedAt, recordedAt)
    insertOccurrence.run("review-source-two", "2026-08-02", recordedAt, recordedAt)
    insertOccurrence.run("review-completion-exact", "2026-08-03", recordedAt, recordedAt)
    insertOccurrence.run("review-completion-invalid", "2026-08-04", recordedAt, recordedAt)
    insertOccurrence.run("review-source-explicit", "2026-08-05", recordedAt, recordedAt)
    const insertAttendance = sqlite.prepare(`
      insert into session_attendance_records (
        id, account_id, occurrence_id, choice, marked_by_account_id, created_at, updated_at
      ) values (?, 'review-player', ?, ?, 'review-coach', ?, ?)
    `)
    insertAttendance.run(
      "review-present", "review-completion-exact", "present", recordedAt, recordedAt,
    )
    insertAttendance.run(
      "review-absent", "review-completion-invalid", "absent", recordedAt, recordedAt,
    )
    const insertAdjustment = sqlite.prepare(`
      insert into attendance_adjustments (
        id, type, player_account_id, source_occurrence_id, completed_on,
        completion_occurrence_id, published_by_account_id, published_at
      ) values (?, 'makeup', 'review-player', ?, ?, ?, 'review-coach', ?)
    `)
    insertAdjustment.run(
      "review-null-one", "review-source-one", "2026-08-03", null, recordedAt,
    )
    insertAdjustment.run(
      "review-null-two", "review-source-two", "2026-08-03", null, recordedAt + 1,
    )
    insertAdjustment.run(
      "review-explicit-invalid",
      "review-source-explicit",
      "2026-08-04",
      "review-completion-invalid",
      recordedAt + 2,
    )

    migrate(database, { migrationsFolder: fullMigrations })

    expect(sqlite.prepare(`
      select id, completion_occurrence_id as completionOccurrenceId,
        review_required_at as reviewRequiredAt
      from attendance_adjustments order by id
    `).all()).toEqual([
      {
        id: "review-explicit-invalid",
        completionOccurrenceId: "review-completion-invalid",
        reviewRequiredAt: recordedAt + 2,
      },
      {
        id: "review-null-one",
        completionOccurrenceId: "review-completion-exact",
        reviewRequiredAt: null,
      },
      {
        id: "review-null-two",
        completionOccurrenceId: null,
        reviewRequiredAt: recordedAt + 1,
      },
    ])
    expect(sqlite.pragma("foreign_key_check")).toEqual([])
    expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok")
    sqlite.close()
  })
})

import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import Database from "better-sqlite3"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const projectRoot = fileURLToPath(new URL("..", import.meta.url))
const fixtureEntry = path.join(projectRoot, "scripts", "regression", "fixture.ts")
const tsxExecutable = path.join(projectRoot, "node_modules", ".bin", "tsx")
const regressionDirectory = path.join(projectRoot, ".data", "regression")
fs.mkdirSync(regressionDirectory, { recursive: true })
const temporaryDirectory = fs.mkdtempSync(path.join(regressionDirectory, "repeatability-test-"))
const sourceDatabase = path.join(temporaryDirectory, "clean-source.db")

type JsonRecord = Record<string, unknown>

// Every fixture command must run asynchronously. A synchronous spawn would
// stall this worker's event loop for the whole subprocess, and Vitest reports
// task results over an RPC channel whose acknowledgement can only be read
// while the loop turns. Fixture builds routinely take longer than the 60-second
// RPC timeout, so a blocking spawn makes Vitest raise an unhandled
// "Timeout calling onTaskUpdate" error and fail an otherwise green run.
function runFixture(databasePath: string, args: string[]) {
  const nodeOptions = [process.env.NODE_OPTIONS, "--conditions=react-server"]
    .filter(Boolean)
    .join(" ")

  return new Promise<string>((resolve, reject) => {
    const fixture = spawn(tsxExecutable, [fixtureEntry, ...args], {
      cwd: projectRoot,
      env: {
        ...process.env,
        DB_FILE_NAME: databasePath,
        NODE_OPTIONS: nodeOptions,
        NODE_PATH: path.join(projectRoot, "node_modules", "next", "dist", "compiled"),
      },
    })

    let stdout = ""
    let stderr = ""
    fixture.stdout.setEncoding("utf8")
    fixture.stderr.setEncoding("utf8")
    fixture.stdout.on("data", (chunk: string) => {
      stdout += chunk
    })
    fixture.stderr.on("data", (chunk: string) => {
      stderr += chunk
    })

    fixture.on("error", reject)
    fixture.on("close", (status) => {
      if (status === 0) {
        resolve(stdout.trim())
        return
      }

      reject(new Error([
        `Fixture command failed: ${args.join(" ")}`,
        stdout.trim(),
        stderr.trim(),
      ].filter(Boolean).join("\n")))
    })
  })
}

async function runJsonFixture(databasePath: string, args: string[]): Promise<JsonRecord> {
  const output = await runFixture(databasePath, args)
  const parsed: unknown = JSON.parse(output)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Expected an object from fixture command: ${args.join(" ")}`)
  }
  return parsed as JsonRecord
}

function findChecksum(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined

  for (const [key, child] of Object.entries(value)) {
    if (/checksum|digest/i.test(key) && typeof child === "string") return child
    const nested = findChecksum(child)
    if (nested) return nested
  }

  return undefined
}

function normalizedVerification(report: JsonRecord) {
  const normalized = { ...report }
  delete normalized.database
  return normalized
}

function fileChecksum(databasePath: string) {
  return createHash("sha256").update(fs.readFileSync(databasePath)).digest("hex")
}

async function prepareAndLoad(databasePath: string, profile = "stress") {
  await runFixture(databasePath, [
    "prepare", "--profile", profile, "--source", sourceDatabase, "--target", databasePath,
  ])
  await runFixture(databasePath, [
    "seed", "--profile", profile, "--stage", "loaded", "--target", databasePath,
  ])
}

function openFixture(databasePath: string) {
  return new Database(databasePath, { readonly: true, fileMustExist: true })
}

function scalar(db: Database.Database, sql: string) {
  return (db.prepare(sql).get() as { count: number }).count
}

afterAll(() => {
  fs.rmSync(temporaryDirectory, { force: true, recursive: true })
})

// Building the source database costs as much as the cases below, so it needs
// the same budget. Vitest's default hook timeout is ten seconds, which a loaded
// machine exceeds and which then fails the whole suite rather than one case.
beforeAll(async () => {
  await runFixture(sourceDatabase, ["prepare-source", "--source", sourceDatabase])
}, 120_000)

describe("regression fixture repeatability", () => {
  it("upgrades only a disposable clone and rejects stale schema without mutating it", async () => {
    const preparedDatabase = path.join(temporaryDirectory, "schema-current.db")
    const sourceBefore = fileChecksum(sourceDatabase)

    const prepared = await runJsonFixture(preparedDatabase, [
      "prepare", "--profile", "stress", "--source", sourceDatabase, "--target", preparedDatabase,
    ])

    expect(prepared).toMatchObject({
      stage: "default",
      schema: {
        current: true,
        latestMigrationTag: "0030_session_occurrence_series_date_lookup",
        migrationCount: 31,
        missingColumns: [],
        missingTables: [],
      },
    })
    expect(fileChecksum(sourceDatabase)).toBe(sourceBefore)

    const staleDatabase = path.join(temporaryDirectory, "schema-stale.db")
    fs.copyFileSync(preparedDatabase, staleDatabase)
    const stale = new Database(staleDatabase)
    try {
      stale.exec(`
        drop table broadcast_withdrawals;
        drop table broadcast_channels;
        drop table broadcast_audience_targets;
        drop table broadcasts;
        alter table accounts drop column registration_request_fingerprint;
        delete from __drizzle_migrations where created_at >= 1786300000000;
      `)
    } finally {
      stale.close()
    }
    const staleBefore = fileChecksum(staleDatabase)
    await expect(runFixture(staleDatabase, [
      "verify", "--profile", "stress", "--target", staleDatabase,
    ])).rejects.toThrow(/Fixture schema is stale[\s\S]*missing tables[\s\S]*missing columns/)
    expect(fileChecksum(staleDatabase)).toBe(staleBefore)

    const orphanDatabase = path.join(temporaryDirectory, "schema-orphan.db")
    fs.copyFileSync(preparedDatabase, orphanDatabase)
    const orphan = new Database(orphanDatabase)
    try {
      orphan.pragma("foreign_keys = OFF")
      orphan.prepare(`
        insert into broadcast_channels (broadcast_id, channel)
        values ('missing-broadcast', 'homepage')
      `).run()
    } finally {
      orphan.close()
    }
    const orphanBefore = fileChecksum(orphanDatabase)
    await expect(runFixture(orphanDatabase, [
      "verify", "--profile", "stress", "--target", orphanDatabase,
    ])).rejects.toThrow(/SQLite foreign-key check failed/)
    expect(fileChecksum(orphanDatabase)).toBe(orphanBefore)

    await expect(runFixture(preparedDatabase, [
      "prepare",
      "--source", preparedDatabase,
      "--target", preparedDatabase,
    ])).rejects.toThrow(/source and target must be different/)
    expect(fs.existsSync(preparedDatabase)).toBe(true)
  }, 120_000)

  it("produces the same normalized verification report across fresh and repeated loads", async () => {
    const firstDatabase = path.join(temporaryDirectory, "first.db")
    const secondDatabase = path.join(temporaryDirectory, "second.db")

    await prepareAndLoad(firstDatabase)
    await prepareAndLoad(secondDatabase)

    const firstVerification = await runJsonFixture(firstDatabase, ["verify", "--target", firstDatabase])
    const secondVerification = await runJsonFixture(secondDatabase, ["verify", "--target", secondDatabase])
    const checksum = findChecksum(firstVerification)

    expect(checksum).toMatch(/^[a-f\d]{64}$/i)
    expect(firstVerification).toMatchObject({
      anchorDate: "2026-08-03",
      profile: "stress",
      stage: "loaded",
      summary: {
        attendanceAdjustments: 2,
        coachProfiles: 3,
        pending: 3,
        players: 100,
        publications: 31,
        recurrenceRules: 48,
        reports: 50,
        series: 12,
        staffAttendance: 41,
      },
    })
    const summary = firstVerification.summary as JsonRecord
    expect(summary.assignmentWeekdays).toEqual(expect.any(Number))
    expect(summary.attendance).toEqual(expect.any(Number))
    expect(summary.occurrences).toEqual(expect.any(Number))
    expect(Number(summary.assignmentWeekdays)).toBeGreaterThan(0)
    expect(Number(summary.attendance)).toBeGreaterThan(0)
    expect(Number(summary.occurrences)).toBeGreaterThan(0)
    expect(normalizedVerification(secondVerification)).toEqual(normalizedVerification(firstVerification))

    await runFixture(firstDatabase, ["seed", "--stage", "loaded", "--target", firstDatabase])
    expect(normalizedVerification(
      await runJsonFixture(firstDatabase, ["verify", "--target", firstDatabase]),
    )).toEqual(normalizedVerification(firstVerification))
  }, 120_000)

  it("persists the representative Stress lifecycle and attendance states", async () => {
    const databasePath = path.join(temporaryDirectory, "stress-lifecycle.db")
    await prepareAndLoad(databasePath)
    const db = openFixture(databasePath)

    try {
      const lifecycle = db.prepare(`
        select
          sum(case when a.archived_at is null and e.status = 'active' then 1 else 0 end) as active,
          sum(case when a.archived_at is not null then 1 else 0 end) as archived,
          sum(case when a.archived_at is null and e.status = 'paused' then 1 else 0 end) as paused,
          sum(case when a.archived_at is null and e.status = 'unassigned' then 1 else 0 end) as unassigned
        from player_enrollments e
        join accounts a on a.id = e.account_id
      `).get() as { active: number; archived: number; paused: number; unassigned: number }
      expect(lifecycle).toEqual({ active: 94, archived: 1, paused: 3, unassigned: 2 })
      expect(scalar(db, `
        select count(*) as count
        from player_enrollments enrollment
        join accounts account on account.id = enrollment.account_id
        where account.approval_status = 'approved'
      `)).toBe(100)

      expect(scalar(db, `
        select count(*) as count from accounts
        where approval_status = 'pending' and requested_role = 'player'
      `)).toBe(3)
      expect(scalar(db, `
        select count(*) as count from coach_profiles where access_level = 'junior_coach'
      `)).toBe(2)

      const staffHistories = db.prepare(`
        select c.account_id as coachId,
          sum(case when a.choice in ('present', 'absent') then 1 else 0 end) as markedFacts,
          sum(case when a.choice = 'present' then 1 else 0 end) as present,
          sum(case when a.choice = 'absent' then 1 else 0 end) as absent,
          sum(case when a.choice = 'cleared' then 1 else 0 end) as cleared
        from coach_profiles c
        join staff_attendance_records a on a.coach_account_id = c.account_id
        where c.access_level = 'junior_coach'
        group by c.account_id
        order by present desc, coachId
      `).all() as Array<{
        absent: number
        cleared: number
        coachId: string
        markedFacts: number
        present: number
      }>
      expect(staffHistories).toHaveLength(2)
      expect(staffHistories.every((history) => history.markedFacts === 20)).toBe(true)
      expect(staffHistories.reduce((total, history) => total + history.cleared, 0)).toBe(1)
      expect(staffHistories.map(({ absent, present }) => ({ absent, present }))).toEqual([
        { absent: 0, present: 20 },
        { absent: 5, present: 15 },
      ])

      const adjustmentStates = db.prepare(`
        select case when voided_at is null then 'active' else 'voided' end as state,
          count(*) as count
        from attendance_adjustments
        group by state
      `).all() as Array<{ count: number; state: string }>
      expect(Object.fromEntries(adjustmentStates.map((row) => [row.state, row.count]))).toEqual({
        active: 1,
        voided: 1,
      })

      expect(scalar(db, `
        select count(*) as count
        from session_occurrences cancelled
        where cancelled.status = 'cancelled'
          and not exists (
            select 1 from session_occurrences replacement
            where replacement.replacement_for_occurrence_id = cancelled.id
          )
      `)).toBeGreaterThanOrEqual(1)

      const replacement = db.prepare(`
        with recursive lineage(replacement_id, current_id, root_date, parent_id, depth) as (
          select id, id, occurrence_date, replacement_for_occurrence_id, 0
          from session_occurrences
          where status = 'scheduled' and replacement_for_occurrence_id is not null
          union all
          select lineage.replacement_id, parent.id, parent.occurrence_date,
            parent.replacement_for_occurrence_id, lineage.depth + 1
          from lineage
          join session_occurrences parent on parent.id = lineage.parent_id
          where lineage.depth < 32
        )
        select replacement.occurrence_date as actualDate, root.root_date as sourceDate,
          cast(strftime('%w', replacement.occurrence_date) as integer) as actualWeekday,
          cast(strftime('%w', root.root_date) as integer) as sourceWeekday,
          (
            select count(distinct assignment.account_id)
            from session_assignments assignment
            join session_assignment_weekdays weekday on weekday.assignment_id = assignment.id
            where assignment.series_id = replacement.series_id
              and root.root_date >= assignment.effective_from
              and (assignment.effective_to is null or root.root_date < assignment.effective_to)
              and weekday.weekday = cast(strftime('%w', root.root_date) as integer)
          ) as sourceRoster
        from session_occurrences replacement
        join lineage root on root.replacement_id = replacement.id and root.parent_id is null
        where replacement.status = 'scheduled'
          and replacement.replacement_for_occurrence_id is not null
          and cast(strftime('%w', replacement.occurrence_date) as integer)
            <> cast(strftime('%w', root.root_date) as integer)
        limit 1
      `).get() as {
        actualDate: string
        actualWeekday: number
        sourceDate: string
        sourceRoster: number
        sourceWeekday: number
      } | undefined
      expect(replacement).toBeDefined()
      expect(replacement?.actualDate).not.toBe(replacement?.sourceDate)
      expect(replacement?.actualWeekday).not.toBe(replacement?.sourceWeekday)
      expect(replacement?.sourceRoster).toBeGreaterThan(0)
    } finally {
      db.close()
    }
  }, 120_000)

  it("persists the representative Stress report, finance, and announcement states", async () => {
    const databasePath = path.join(temporaryDirectory, "stress-records.db")
    await prepareAndLoad(databasePath)
    const db = openFixture(databasePath)

    try {
      expect(scalar(db, "select count(*) as count from monthly_reports")).toBe(50)
      expect(scalar(db, "select count(*) as count from report_publications")).toBe(31)
      expect(scalar(db, `
        select count(*) as count from (
          select report_id from report_publications
          group by report_id having count(*) > 1
        )
      `)).toBeGreaterThanOrEqual(1)

      expect(scalar(db, "select count(*) as count from payments where lifecycle = 'reversed'"))
        .toBeGreaterThanOrEqual(1)
      expect(scalar(db, `
        select count(distinct reversed.id) as count
        from payments reversed
        join payment_allocations original on original.payment_id = reversed.id
        join payment_allocations replacement on replacement.charge_id = original.charge_id
          and replacement.payment_id <> reversed.id
        join payments current on current.id = replacement.payment_id
        where reversed.lifecycle = 'reversed' and current.lifecycle = 'recorded'
      `)).toBeGreaterThanOrEqual(1)
      expect(scalar(db, "select count(*) as count from charge_adjustments where kind = 'manual_credit'"))
        .toBeGreaterThanOrEqual(1)
      expect(scalar(db, "select count(*) as count from charge_adjustments where kind = 'manual_debit'"))
        .toBeGreaterThanOrEqual(1)
      expect(scalar(db, "select count(*) as count from refunds where lifecycle = 'recorded'"))
        .toBeGreaterThanOrEqual(1)
      expect(scalar(db, "select count(*) as count from refunds where lifecycle = 'reversed'"))
        .toBeGreaterThanOrEqual(1)
      expect(scalar(db, "select count(*) as count from concessions where lifecycle = 'active'"))
        .toBeGreaterThanOrEqual(1)
      expect(scalar(db, "select count(*) as count from concessions where lifecycle = 'reversed'"))
        .toBeGreaterThanOrEqual(1)
      expect(scalar(db, `
        select count(*) as count from (
          select player_account_id from fee_agreements
          group by player_account_id
          having sum(case when status = 'ended' then 1 else 0 end) > 0
            and sum(case when status = 'active' then 1 else 0 end) > 0
        )
      `)).toBeGreaterThanOrEqual(1)

      expect(scalar(db, "select count(*) as count from broadcasts")).toBe(5)
      expect(scalar(db, `
        select count(*) as count from broadcasts b
        join broadcast_audience_targets target on target.broadcast_id = b.id
        where target.audience = 'everyone'
      `)).toBe(5)
      expect(scalar(db, `
        select count(*) as count from broadcasts b
        where b.pinned = 1
          and (b.expires_on is null or b.expires_on >= '2026-08-03')
          and not exists (select 1 from broadcast_withdrawals w where w.broadcast_id = b.id)
      `)).toBeGreaterThanOrEqual(1)
      expect(scalar(db, `
        select count(*) as count from broadcasts b
        where b.expires_on < '2026-08-03'
          and not exists (select 1 from broadcast_withdrawals w where w.broadcast_id = b.id)
      `)).toBeGreaterThanOrEqual(1)
      expect(scalar(db, "select count(*) as count from broadcast_withdrawals"))
        .toBeGreaterThanOrEqual(1)
      expect(scalar(db, `
        select count(*) as count from broadcasts b
        where exists (
          select 1 from broadcast_channels channel
          where channel.broadcast_id = b.id and channel.channel = 'homepage'
        ) and not exists (
          select 1 from broadcast_channels channel
          where channel.broadcast_id = b.id and channel.channel = 'player_dashboard'
        )
      `)).toBeGreaterThanOrEqual(1)
      expect(scalar(db, `
        select count(*) as count from broadcasts b
        where exists (
          select 1 from broadcast_channels channel
          where channel.broadcast_id = b.id and channel.channel = 'player_dashboard'
        ) and not exists (
          select 1 from broadcast_channels channel
          where channel.broadcast_id = b.id and channel.channel = 'homepage'
        )
      `)).toBeGreaterThanOrEqual(1)
      expect(scalar(db, `
        select count(*) as count from broadcasts b
        where (
          select count(distinct channel.channel) from broadcast_channels channel
          where channel.broadcast_id = b.id
        ) = 2
      `)).toBeGreaterThanOrEqual(1)
    } finally {
      db.close()
    }
  }, 120_000)

  it.each([
    ["demo", 40, 2, 3, 40, 10, 9],
    ["edge", 32, 3, 3, 41, 10, 7],
  ] as const)(
    "builds a deterministic %s profile with staff and supported exceptions",
    async (profile, players, pending, coachProfiles, staffAttendance, reports, publications) => {
      const firstDatabase = path.join(temporaryDirectory, `${profile}-first.db`)
      const secondDatabase = path.join(temporaryDirectory, `${profile}-second.db`)
      await prepareAndLoad(firstDatabase, profile)
      await prepareAndLoad(secondDatabase, profile)

      const first = await runJsonFixture(firstDatabase, [
        "verify", "--profile", profile, "--target", firstDatabase,
      ])
      const second = await runJsonFixture(secondDatabase, [
        "verify", "--profile", profile, "--target", secondDatabase,
      ])
      expect(first).toMatchObject({
        profile,
        stage: "loaded",
        summary: {
          attendanceAdjustments: 2,
          coachProfiles,
          pending,
          players,
          publications,
          reports,
          staffAttendance,
        },
      })

      if (profile === "demo") {
        const db = openFixture(firstDatabase)
        try {
          const months = db.prepare(`
            select distinct report.month
            from monthly_reports report
            join report_publications publication on publication.report_id = report.id
            where report.account_id = (
              select account.id
              from accounts account
              join academy_id_allocations allocation on allocation.account_id = account.id
              where account.role = 'player'
              order by allocation.serial
              limit 1
            )
            order by report.month desc
          `).all().map((row) => (row as { month: string }).month)
          expect(months).toEqual([
            "2026-07",
            "2026-06",
            "2026-05",
            "2026-04",
            "2026-03",
          ])
        } finally {
          db.close()
        }
      }
      expect(normalizedVerification(second)).toEqual(normalizedVerification(first))
    },
    120_000,
  )
})

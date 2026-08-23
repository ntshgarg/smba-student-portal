import { createHash, randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import Database from "better-sqlite3"
import { and, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { readMigrationFiles } from "drizzle-orm/migrator"

import {
  ACADEMY_ID_SERIAL_RANGES,
  formatAcademyId,
  HEAD_COACH_ACADEMY_ID,
} from "../../lib/auth/identity"

import {
  createPlayerDefinitions,
  fixtureProfiles,
  FIXTURE_ANCHOR_DATE,
  FIXTURE_SCHEDULE_END,
  FIXTURE_SCHEDULE_START,
  profileManifestPath,
  resolveFixtureProfile,
  type AcademyPlan,
  type FixtureProfile,
  type PlayerDefinition,
  type TrainingBatch,
  type TrainingLevel,
} from "./profiles"

const COACH_ID = "00000000-0000-4000-8000-000000000001"
const LEGACY_COACH_ACADEMY_ID = "SMBA#0001"
const COACH_ACADEMY_ID = HEAD_COACH_ACADEMY_ID
const CANONICAL_DATE = FIXTURE_ANCHOR_DATE
const SCHEDULE_START = FIXTURE_SCHEDULE_START
const SCHEDULE_END = FIXTURE_SCHEDULE_END
const REPORT_MONTH = "2026-07"
const REPORT_REFERENCE_DATE = "2026-07-31"
const FINANCE_TRACKING_MONTH = "2026-07"
const CURRENT_FEE_PERIOD = "2026-08"
const FINANCE_REFERENCE_DATE = "2026-08-03"
const REGRESSION_DIRECTORY = path.resolve(process.cwd(), ".data/regression")
const DEFAULT_SOURCE = path.resolve(process.cwd(), ".data/regression/fixture-source.db")
const CLEAN_TARGET = path.resolve(process.cwd(), ".data/academy-clean.db")
const MIGRATIONS_DIRECTORY = path.resolve(process.cwd(), "drizzle")
const DATABASE_PREPARE_ENTRY = path.resolve(process.cwd(), "scripts/database/prepare.ts")
const TSX_EXECUTABLE = path.resolve(process.cwd(), "node_modules/.bin/tsx")
const REQUIRED_CURRENT_TABLES = [
  "auth_access_codes",
  "auth_authenticator_reset_requests",
  "auth_credential_states",
  "auth_login_attempts",
  "auth_provider_accounts",
  "auth_rate_limits",
  "auth_runtime_sessions",
  "auth_security_events",
  "auth_setup_claims",
  "auth_two_factors",
  "auth_users",
  "auth_verifications",
  "operational_events",
  "broadcasts",
  "broadcast_audience_targets",
  "broadcast_channels",
  "broadcast_withdrawals",
] as const
const REQUIRED_CURRENT_COLUMNS = {
  accounts: ["registration_request_fingerprint", "registration_request_key"],
  refunds: ["purpose", "withdrawal_effective_on", "charge_adjustment_id"],
} as const
const CLEAN_OPERATIONAL_TABLES = [
  "player_enrollments",
  "batch_memberships",
  "attendance_records",
  "session_series",
  "session_recurrence_rules",
  "session_occurrences",
  "session_assignments",
  "session_assignment_weekdays",
  "session_attendance_records",
  "attendance_adjustments",
  "monthly_reports",
  "report_publications",
  "fee_agreements",
  "financial_charges",
  "payments",
  "payment_allocations",
  "refunds",
  "refund_allocations",
  "charge_adjustments",
  "concessions",
  "concession_applications",
  "finance_reference_sequences",
  "financial_audit_events",
  "staff_attendance_records",
  "broadcasts",
  "broadcast_audience_targets",
  "broadcast_channels",
  "broadcast_withdrawals",
  "auth_setup_claims",
  "operational_events",
] as const
const selectedProfile = resolveFixtureProfile((() => {
  const args = process.argv.slice(2)
  const index = args.indexOf("--profile")
  return index >= 0 ? args[index + 1] : process.env.SMBA_FIXTURE_PROFILE
})())
const DEFAULT_TARGET = selectedProfile.target

const representativeReportHistory = selectedProfile.key === "demo" ? [
  {
    month: "2026-03",
    publishedAt: "2026-04-03T18:00:00+05:30",
    reportText: "has settled into the training rhythm with steady attention to grip, ready position, and a balanced split step. The clearest improvement is arriving behind the shuttle before starting the stroke.\n\nThe next focus is to keep the racket preparation compact and return to base without crossing the feet.",
  },
  {
    month: "2026-04",
    publishedAt: "2026-05-03T18:00:00+05:30",
    reportText: "is moving into the rear court with better balance and is beginning to contact the shuttle higher. Recovery after the overhead stroke is calmer, which is helping the next movement begin on time.\n\nThe next step is to keep the non-racket arm active and maintain the same shape when the pace increases.",
  },
  {
    month: "2026-05",
    publishedAt: "2026-06-03T18:00:00+05:30",
    reportText: "has become more deliberate in serve-and-return practice. Short serves are landing with better control, and the first three shots of the rally now show clearer intent instead of being rushed.\n\nThe coming month should build confidence in choosing when to lift, block, or move forward to the net.",
  },
  {
    month: "2026-06",
    publishedAt: "2026-07-03T18:00:00+05:30",
    reportText: "is sustaining longer rallies with improved patience and a more reliable recovery step. The strongest progress this month has been keeping the body composed after a difficult defensive shot.\n\nThe next focus is to turn that control into purposeful rally construction, especially through the backhand side.",
  },
] as const : []

type Stage = "default" | "registrations" | "enrollments" | "schedules" | "loaded"

type FixtureSchemaContract = {
  latestMigrationTag: string
  latestMigrationWhen: number
  migrationCount: number
  migrationFingerprint: string
}

type FixtureSchemaState = FixtureSchemaContract & {
  current: boolean
  missingColumns: string[]
  missingTables: string[]
}

type ScheduleDefinition = {
  batch: TrainingBatch
  level: TrainingLevel
  startTime: string
  weekdays: number[]
}

const lastNames = [
  "Bhat", "Desai", "Gupta", "Iyer", "Kapoor",
  "Menon", "Nair", "Patel", "Rao", "Sharma",
]

const players = createPlayerDefinitions(selectedProfile)

const schedules: ScheduleDefinition[] = [
  { level: "Beginner", batch: "Weekday", startTime: "06:00", weekdays: [1, 2, 3, 4, 5] },
  { level: "Intermediate", batch: "Weekday", startTime: "07:00", weekdays: [1, 2, 3, 4, 5] },
  { level: "Advanced", batch: "Weekday", startTime: "08:00", weekdays: [1, 2, 3, 4, 5] },
  { level: "Adult", batch: "Weekday", startTime: "09:00", weekdays: [1, 2, 3, 4, 5] },
  { level: "Beginner", batch: "Weekday", startTime: "16:00", weekdays: [1, 2, 3, 4, 5] },
  { level: "Intermediate", batch: "Weekday", startTime: "17:00", weekdays: [1, 2, 3, 4, 5] },
  { level: "Advanced", batch: "Weekday", startTime: "18:00", weekdays: [1, 2, 3, 4, 5] },
  { level: "Adult", batch: "Weekday", startTime: "19:00", weekdays: [1, 2, 3, 4, 5] },
  { level: "Beginner", batch: "Weekend", startTime: "07:00", weekdays: [6, 0] },
  { level: "Intermediate", batch: "Weekend", startTime: "08:00", weekdays: [6, 0] },
  { level: "Advanced", batch: "Weekend", startTime: "09:00", weekdays: [6, 0] },
  { level: "Adult", batch: "Weekend", startTime: "10:00", weekdays: [6, 0] },
]

function parseArguments() {
  const [command = "verify", ...rest] = process.argv.slice(2)
  const option = (name: string) => {
    const index = rest.indexOf(`--${name}`)
    return index >= 0 ? rest[index + 1] : undefined
  }
  const defaultTarget = command === "build-clean" ? CLEAN_TARGET : DEFAULT_TARGET
  return {
    command,
    profile: selectedProfile,
    source: path.resolve(option("source") ?? DEFAULT_SOURCE),
    stage: (option("stage") ?? "loaded") as Stage,
    target: path.resolve(option("target") ?? process.env.SMBA_REGRESSION_DB ?? defaultTarget),
  }
}

function isAccessibilityTemporaryTarget(target: string) {
  const temporaryRoots = new Set([
    path.resolve(os.tmpdir()),
    path.resolve("/tmp"),
  ])
  const insideTemporaryRoot = [...temporaryRoots].some((root) => {
    const relative = path.relative(root, target)
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  })
  return insideTemporaryRoot
    && /smba[-_.].*(accessibility|a11y)|smba-accessibility/u.test(path.basename(target))
}

function assertRegressionTarget(target: string) {
  const relative = path.relative(REGRESSION_DIRECTORY, target)
  const isRegressionTarget = Boolean(relative)
    && !relative.startsWith("..")
    && !path.isAbsolute(relative)
  const isNamedProfileTarget = Object.values(fixtureProfiles)
    .some((profile) => target === profile.target)
  const isCleanTarget = target === CLEAN_TARGET
  if (!isRegressionTarget
    && !isNamedProfileTarget
    && !isCleanTarget
    && !isAccessibilityTemporaryTarget(target)) {
    throw new Error(
      `Fixture databases must use a named profile path or live inside ${REGRESSION_DIRECTORY}.`,
    )
  }
  if (target === DEFAULT_SOURCE || path.basename(target) === "smba.db") {
    throw new Error("Refusing to use the clean SMBA database as a regression target.")
  }
}

function assertGeneratedSourceTarget(target: string) {
  if (isAccessibilityTemporaryTarget(target)) return
  const relative = path.relative(REGRESSION_DIRECTORY, target)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Generated fixture sources must live inside ${REGRESSION_DIRECTORY}.`)
  }
}

function openReadonly(databasePath: string) {
  return new Database(databasePath, { readonly: true, fileMustExist: true })
}

function tableCount(db: Database.Database, table: string) {
  return (db.prepare(`select count(*) as count from ${table}`).get() as { count: number }).count
}

function tableExists(db: Database.Database, table: string) {
  return Boolean(db.prepare(
    "select 1 from sqlite_master where type = 'table' and name = ?",
  ).get(table))
}

function safeTableCount(db: Database.Database, table: string) {
  return tableExists(db, table) ? tableCount(db, table) : 0
}

function migrationJournal() {
  const journal = JSON.parse(fs.readFileSync(
    path.join(MIGRATIONS_DIRECTORY, "meta", "_journal.json"),
    "utf8",
  )) as {
    entries: Array<{ tag: string; when: number }>
  }
  const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS_DIRECTORY })
  if (journal.entries.length !== migrations.length || migrations.length === 0) {
    throw new Error("The Drizzle migration journal and migration files are inconsistent.")
  }
  return journal.entries.map((entry, index) => ({
    createdAt: migrations[index].folderMillis,
    hash: migrations[index].hash,
    tag: entry.tag,
  }))
}

function migrationFingerprint(rows: Array<{ createdAt: number; hash: string }>) {
  return createHash("sha256")
    .update(rows.map(({ createdAt, hash }) => `${createdAt}:${hash}`).join("\n"))
    .digest("hex")
}

function expectedFixtureSchema(): FixtureSchemaContract {
  const migrations = migrationJournal()
  const latest = migrations.at(-1)
  if (!latest) throw new Error("At least one database migration is required.")
  return {
    latestMigrationTag: latest.tag,
    latestMigrationWhen: latest.createdAt,
    migrationCount: migrations.length,
    migrationFingerprint: migrationFingerprint(
      migrations.map(({ createdAt, hash }) => ({ createdAt, hash })),
    ),
  }
}

function tableColumns(db: Database.Database, table: string) {
  if (!tableExists(db, table)) return new Set<string>()
  const rows = db.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>
  return new Set(rows.map((row) => row.name))
}

function inspectFixtureSchema(db: Database.Database): FixtureSchemaState {
  const expected = expectedFixtureSchema()
  const applied = tableExists(db, "__drizzle_migrations")
    ? db.prepare(`
        select hash, created_at as createdAt
        from __drizzle_migrations
        order by created_at, hash
      `).all() as Array<{ createdAt: number; hash: string }>
    : []
  const expectedMigrations = migrationJournal().map(({ createdAt, hash }) => ({ createdAt, hash }))
  const missingTables = REQUIRED_CURRENT_TABLES.filter((table) => !tableExists(db, table))
  const missingColumns = Object.entries(REQUIRED_CURRENT_COLUMNS).flatMap(([table, columns]) => {
    const actual = tableColumns(db, table)
    return columns.filter((column) => !actual.has(column)).map((column) => `${table}.${column}`)
  })
  const appliedFingerprint = migrationFingerprint(applied)
  const expectedFingerprint = migrationFingerprint(expectedMigrations)
  const latestApplied = applied.at(-1)
  return {
    current: applied.length === expected.migrationCount
      && appliedFingerprint === expectedFingerprint
      && missingTables.length === 0
      && missingColumns.length === 0,
    latestMigrationTag: expected.latestMigrationTag,
    latestMigrationWhen: latestApplied?.createdAt ?? 0,
    migrationCount: applied.length,
    migrationFingerprint: appliedFingerprint,
    missingColumns,
    missingTables: [...missingTables],
  }
}

function verifyFixtureSchema(db: Database.Database) {
  const expected = expectedFixtureSchema()
  const actual = inspectFixtureSchema(db)
  if (actual.current) return actual

  const problems = [
    actual.migrationCount !== expected.migrationCount
      ? `applied migrations ${actual.migrationCount}/${expected.migrationCount}`
      : undefined,
    actual.migrationFingerprint !== expected.migrationFingerprint
      ? "applied migration hashes do not match the checked-in journal"
      : undefined,
    actual.missingTables.length ? `missing tables: ${actual.missingTables.join(", ")}` : undefined,
    actual.missingColumns.length ? `missing columns: ${actual.missingColumns.join(", ")}` : undefined,
  ].filter(Boolean)
  throw new Error(`Fixture schema is stale (${problems.join("; ")}). Run prepare/build before automation.`)
}

function verifyDatabaseIntegrity(db: Database.Database) {
  const integrityRows = db.pragma("integrity_check") as Array<Record<string, unknown>>
  const integrityMessages = integrityRows.flatMap((row) => Object.values(row))
    .filter((value): value is string => typeof value === "string")
  if (integrityMessages.length !== 1 || integrityMessages[0] !== "ok") {
    throw new Error(`SQLite integrity check failed: ${integrityMessages.join("; ") || "unknown error"}`)
  }
  const foreignKeyRows = db.pragma("foreign_key_check") as Array<Record<string, unknown>>
  if (foreignKeyRows.length) {
    throw new Error(`SQLite foreign-key check failed for ${foreignKeyRows.length} row(s).`)
  }
  return { foreignKeys: "ok" as const, sqlite: "ok" as const }
}

function databaseIdentity(databasePath: string) {
  const absolute = path.resolve(databasePath)
  return fs.existsSync(absolute) ? fs.realpathSync(absolute) : absolute
}

function assertDistinctSourceAndTarget(source: string, target: string) {
  if (databaseIdentity(source) === databaseIdentity(target)) {
    throw new Error("Fixture source and target must be different database files.")
  }
}

function assertPublicationTargetQuiescent(target: string) {
  if (!fs.existsSync(target)) return
  const sidecars = [`${target}-wal`, `${target}-shm`].filter((candidate) => fs.existsSync(candidate))
  const openHandles = spawnSync("lsof", [target, ...sidecars], { encoding: "utf8" })
  if (openHandles.error && sidecars.length) {
    throw new Error(
      `Cannot prove that ${path.basename(target)} is quiescent because lsof is unavailable. Stop the server and remove closed SQLite sidecars before rebuilding it.`,
    )
  }
  if (openHandles.status === 0 && openHandles.stdout.trim()) {
    throw new Error(
      `Refusing to publish over the open SQLite profile ${path.basename(target)}. Stop the server using this profile before rebuilding it.`,
    )
  }
  if (openHandles.status !== null && ![0, 1].includes(openHandles.status)) {
    throw new Error(`Could not determine whether ${path.basename(target)} is open.`)
  }
  sidecars.forEach((candidate) => fs.unlinkSync(candidate))
}

function migrateFixtureTarget(target: string) {
  const sqlite = new Database(target, { fileMustExist: true })
  try {
    sqlite.pragma("foreign_keys = ON")
    migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS_DIRECTORY })
  } finally {
    sqlite.close()
  }
}

function assertCleanSource(source: string) {
  const db = openReadonly(source)
  try {
    const coach = db.prepare(`
      select a.full_name as fullName, a.role, a.approval_status as approvalStatus, m.identifier
      from accounts a
      join auth_methods m on m.account_id = a.id and m.revoked_at is null
    `).get() as { approvalStatus: string; fullName: string; identifier: string; role: string } | undefined
    if (tableCount(db, "accounts") !== 1
      || ![LEGACY_COACH_ACADEMY_ID, COACH_ACADEMY_ID].includes(coach?.identifier ?? "")
      || coach?.role !== "coach"
      || coach?.approvalStatus !== "approved") {
      throw new Error("The source database is not the clean coach-only SMBA state.")
    }
    if (CLEAN_OPERATIONAL_TABLES.some(
      (table) => tableExists(db, table) && tableCount(db, table) !== 0,
    )) {
      throw new Error("The source database contains operational data and cannot seed this regression.")
    }
  } finally {
    db.close()
  }
}

function defaultSourceIsCurrent(source: string) {
  if (!fs.existsSync(source)) return false
  try {
    const db = openReadonly(source)
    try {
      verifyFixtureSchema(db)
      verifyDatabaseIntegrity(db)
    } finally {
      db.close()
    }
    assertCleanSource(source)
    return true
  } catch {
    return false
  }
}

function prepareGeneratedSource(source: string) {
  assertGeneratedSourceTarget(source)
  const temporarySource = path.join(
    REGRESSION_DIRECTORY,
    `.fixture-source-build-${process.pid}.db`,
  )
  fs.mkdirSync(REGRESSION_DIRECTORY, { recursive: true })
  try {
    for (const candidate of [
      temporarySource,
      `${temporarySource}-wal`,
      `${temporarySource}-shm`,
    ]) {
      if (fs.existsSync(candidate)) fs.unlinkSync(candidate)
    }
    const nodeOptions = [process.env.NODE_OPTIONS, "--conditions=react-server"]
      .filter(Boolean)
      .join(" ")
    const prepared = spawnSync(TSX_EXECUTABLE, [DATABASE_PREPARE_ENTRY, "--seed"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        DB_FILE_NAME: temporarySource,
        NODE_OPTIONS: nodeOptions,
        NODE_PATH: path.resolve(process.cwd(), "node_modules/next/dist/compiled"),
        SMBA_REQUIRE_RECOVERY_EMAIL: "false",
        SMBA_USE_TURSO: "false",
        TURSO_AUTH_TOKEN: "",
        TURSO_DATABASE_URL: "",
        VERCEL: "",
        VERCEL_ENV: "",
      },
    })
    if (prepared.error) throw prepared.error
    if (prepared.status !== 0) {
      throw new Error([
        "Clean fixture source preparation failed.",
        prepared.stdout.trim(),
        prepared.stderr.trim(),
      ].filter(Boolean).join("\n"))
    }
    assertCleanSource(temporarySource)
    const db = openReadonly(temporarySource)
    try {
      verifyFixtureSchema(db)
      verifyDatabaseIntegrity(db)
    } finally {
      db.close()
    }
    assertPublicationTargetQuiescent(source)
    fs.renameSync(temporarySource, source)
    return { source, schema: expectedFixtureSchema() }
  } finally {
    for (const candidate of [
      temporarySource,
      `${temporarySource}-wal`,
      `${temporarySource}-shm`,
    ]) {
      if (fs.existsSync(candidate)) fs.unlinkSync(candidate)
    }
  }
}

function ensureGeneratedSource(source: string) {
  if (source !== DEFAULT_SOURCE || defaultSourceIsCurrent(source)) return
  prepareGeneratedSource(source)
}

function normalizeFixtureHeadCoachIdentity(target: string) {
  const db = new Database(target, { fileMustExist: true })
  try {
    db.pragma("foreign_keys = ON")
    db.transaction(() => {
      db.prepare(`
        update academy_id_allocations
        set serial = ?
        where account_id = ?
      `).run(ACADEMY_ID_SERIAL_RANGES.headCoach.first, COACH_ID)
      db.prepare(`
        update auth_methods
        set identifier = ?
        where account_id = ? and method = 'academy_id' and revoked_at is null
      `).run(COACH_ACADEMY_ID, COACH_ID)
    })()
  } finally {
    db.close()
  }
}

async function prepare(source: string, target: string) {
  assertRegressionTarget(target)
  assertDistinctSourceAndTarget(source, target)
  assertCleanSource(source)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  for (const candidate of [target, `${target}-wal`, `${target}-shm`]) {
    if (fs.existsSync(candidate)) fs.unlinkSync(candidate)
  }
  const sourceDatabase = new Database(source, { readonly: true, fileMustExist: true })
  try {
    await sourceDatabase.backup(target)
  } finally {
    sourceDatabase.close()
  }
  migrateFixtureTarget(target)
  normalizeFixtureHeadCoachIdentity(target)
  await provisionFixtureCredentials(target)
  return verify(target, "default")
}

async function applicationModules(target: string) {
  process.env.DB_FILE_NAME = target
  const [
    { initializeDatabase },
    accountService,
    sessionService,
    financeService,
    financeConfig,
    dbSchema,
    attendanceAdjustments,
    memberService,
    announcementService,
    credentialService,
  ] = await Promise.all([
    import("../../lib/db/client"),
    import("../../lib/auth/account-service"),
    import("../../lib/sessions/service"),
    import("../../lib/finance/service"),
    import("../../lib/finance/config"),
    import("../../lib/db/schema"),
    import("../../lib/attendance/adjustments"),
    import("../../lib/coach/member-service"),
    import("../../lib/announcements/service"),
    import("../../lib/auth/credential-service"),
  ])
  return {
    database: initializeDatabase(),
    accountService,
    sessionService,
    financeService,
    financeConfig,
    dbSchema,
    attendanceAdjustments,
    memberService,
    announcementService,
    credentialService,
  }
}

async function provisionFixtureCredentials(target: string) {
  const { credentialService } = await applicationModules(target)
  const db = openReadonly(target)
  const approvedAccounts = db.prepare(`
    select a.id, a.full_name as fullName, m.identifier as academyId
    from accounts a
    join auth_methods m on m.account_id = a.id
      and m.method = 'academy_id'
      and m.revoked_at is null
    where a.approval_status = 'approved' and a.archived_at is null
    order by m.identifier
  `).all() as Array<{ academyId: string; fullName: string; id: string }>
  db.close()

  approvedAccounts.forEach((account) => credentialService.provisionDevelopmentCredential({
    academyId: account.academyId,
    accountId: account.id,
    fullName: account.fullName,
    password: process.env.SMBA_FIXTURE_PASSWORD ?? credentialService.FIXTURE_PASSWORD,
  }))
}

function pendingAccounts(db: Database.Database) {
  return db.prepare(`
    select id, full_name as fullName, created_at as createdAt
    from accounts
    where approval_status = 'pending' and requested_role = 'player'
    order by created_at, id
  `).all() as Array<{ createdAt: number; fullName: string; id: string }>
}

async function seedRegistrations(target: string) {
  assertRegressionTarget(target)
  const current = summaryFor(target)
  const registrationCount = players.length
    + selectedProfile.juniorCoaches.length
    + selectedProfile.pendingPlayerNames.length
  // Later fixture stages already satisfy registration. Defer verification to
  // seedToStage(), which knows the caller's requested final stage.
  if (current.players === players.length
    && current.pending === selectedProfile.pendingPlayerNames.length) return
  if (current.pending === registrationCount && current.players === 0) return
  if (current.accounts !== 1 || current.pending !== 0 || current.players !== 0) {
    throw new Error("Registration stage is partial; prepare a fresh regression database.")
  }
  const { accountService } = await applicationModules(target)
  selectedProfile.juniorCoaches.forEach((coach) => (
    accountService.registerAccount(coach.fullName, "coach")
  ))
  players.forEach((player) => accountService.registerAccount(player.fullName, "player"))
  selectedProfile.pendingPlayerNames.forEach((fullName) => (
    accountService.registerAccount(fullName, "player")
  ))
  return verify(target, "registrations")
}

function registrationsInDefinitionOrder(db: Database.Database) {
  const buckets = new Map<string, Array<{ id: string }>>()
  pendingAccounts(db).forEach((account) => {
    const values = buckets.get(account.fullName) ?? []
    values.push({ id: account.id })
    buckets.set(account.fullName, values)
  })
  return players.map((player) => {
    const bucket = buckets.get(player.fullName)
    const registration = bucket?.shift()
    if (!registration) throw new Error(`Missing pending registration for ${player.fullName}.`)
    return registration
  })
}

async function seedEnrollments(target: string) {
  const summary = summaryFor(target)
  const registrationCount = players.length
    + selectedProfile.juniorCoaches.length
    + selectedProfile.pendingPlayerNames.length
  if (summary.players === players.length
    && summary.pending === selectedProfile.pendingPlayerNames.length) {
    await provisionFixtureCredentials(target)
    return
  }
  if (summary.pending !== registrationCount || summary.players !== 0) {
    throw new Error(`Enrollment stage requires exactly ${registrationCount} pending registrations.`)
  }
  const read = openReadonly(target)
  const registrations = registrationsInDefinitionOrder(read)
  const juniorRegistrations = selectedProfile.juniorCoaches.map((coach) => {
    const registration = read.prepare(`
      select id from accounts
      where approval_status = 'pending' and requested_role = 'coach' and full_name = ?
    `).get(coach.fullName) as { id: string } | undefined
    if (!registration) throw new Error(`Missing pending junior-coach registration for ${coach.fullName}.`)
    return { ...coach, id: registration.id }
  })
  read.close()
  const { accountService } = await applicationModules(target)
  const approvalTime = new Date(`${SCHEDULE_START}T09:00:00+05:30`)
  juniorRegistrations.forEach((registration) => accountService.approveRegistration(
    registration.id,
    COACH_ID,
    { chooseAcademyIdIndex: () => 0, now: approvalTime, requestedRole: "coach" },
  ))
  registrations.forEach((registration) => accountService.approveRegistration(
    registration.id,
    COACH_ID,
    { chooseAcademyIdIndex: () => 0, now: approvalTime, requestedRole: "player" },
  ))

  const db = new Database(target)
  db.pragma("foreign_keys = ON")
  if (tableExists(db, "coach_profiles")) {
    const insertCoachProfile = db.prepare(`
      insert into coach_profiles
        (account_id, access_level, joined_on, created_at, updated_at)
      values (?, 'junior_coach', ?, ?, ?)
      on conflict(account_id) do update set
        access_level = excluded.access_level,
        joined_on = excluded.joined_on,
        updated_at = excluded.updated_at
    `)
    juniorRegistrations.forEach((coach) => insertCoachProfile.run(
      coach.id,
      SCHEDULE_START,
      approvalTime.getTime(),
      approvalTime.getTime(),
    ))
  }
  const approved = db.prepare(`
    select a.id, x.serial
    from accounts a
    join academy_id_allocations x on x.account_id = a.id
    where a.role = 'player' and a.approval_status = 'approved'
    order by x.serial
  `).all() as Array<{ id: string; serial: number }>
  const update = db.prepare(`
    update player_enrollments
    set level = ?, batch = ?, academy_plan = ?, status = 'unassigned', training_start_on = ?,
        training_start_confirmed_at = ?, training_start_confirmed_by_account_id = ?,
        primary_contact_name = ?, primary_contact_relationship = 'Parent',
        primary_contact_phone = ?, updated_at = ?
    where account_id = ?
  `)
  const trainingStartOn = SCHEDULE_START
  const updatedAt = Date.parse(`${CANONICAL_DATE}T00:00:00.000Z`)
  db.transaction(() => {
    approved.forEach((account, index) => {
      const player = players[index]
      update.run(
        player.level,
        player.batch,
        player.academyPlan,
        trainingStartOn,
        updatedAt,
        COACH_ID,
        `${lastNames[index % lastNames.length]} Family`,
        `+91 00000 ${String(index + 1).padStart(5, "0")}`,
        updatedAt,
        account.id,
      )
    })
  })()
  db.close()
  await provisionFixtureCredentials(target)
  return verify(target, "enrollments")
}

async function seedSchedules(target: string) {
  const current = summaryFor(target)
  if (current.series === schedules.length) return
  if (current.players !== players.length
    || current.pending !== selectedProfile.pendingPlayerNames.length
    || current.series !== 0) {
    throw new Error(
      `Schedule stage requires ${players.length} approved players and no existing schedules.`,
    )
  }
  const { database, sessionService } = await applicationModules(target)
  const now = new Date(`${CANONICAL_DATE}T00:00:00+05:30`)
  schedules.forEach((schedule) => {
    sessionService.createSessionSeriesRecords({
      coachId: COACH_ID,
      database,
      input: {
        programme: schedule.level,
        batch: schedule.batch,
        venue: "SMBA Court",
        startsOn: SCHEDULE_START,
        endsOn: SCHEDULE_END,
        weekdays: schedule.weekdays,
        startTime: schedule.startTime,
        durationMinutes: 60,
      },
      now,
    })
  })
  return verify(target, "schedules")
}

function selectedWeekdays(player: PlayerDefinition) {
  if (player.batch === "Weekend") return [0, 6]
  if (player.academyPlan === "weekday-5-day") return [1, 2, 3, 4, 5]
  if (player.academyPlan === "weekday-4-day") {
    const omitted = (player.planOrdinal % 5) + 1
    return [1, 2, 3, 4, 5].filter((weekday) => weekday !== omitted)
  }
  const patterns = [
    [1, 3, 5],
    [2, 4, 5],
    [1, 2, 4],
    [2, 3, 5],
    [1, 3, 4],
  ]
  return patterns[player.planOrdinal % patterns.length]
}

function approvedPlayers(db: Database.Database) {
  return db.prepare(`
    select a.id, x.serial
    from accounts a
    join academy_id_allocations x on x.account_id = a.id
    where a.role = 'player' and a.approval_status = 'approved'
    order by x.serial
  `).all() as Array<{ id: string; serial: number }>
}

function seriesLookup(db: Database.Database) {
  const rows = db.prepare(`
    select s.id, s.programme as level, s.batch, r.start_time as startTime
    from session_series s
    join session_recurrence_rules r on r.series_id = s.id
    where s.status = 'active'
    group by s.id, s.programme, s.batch, r.start_time
  `).all() as Array<{ batch: TrainingBatch; id: string; level: TrainingLevel; startTime: string }>
  return new Map(rows.map((row) => [`${row.level}:${row.batch}:${row.startTime}`, row.id]))
}

function slotTime(player: PlayerDefinition) {
  if (player.batch === "Weekend") {
    return { Beginner: "07:00", Intermediate: "08:00", Advanced: "09:00", Adult: "10:00" }[player.level]
  }
  const values: Record<TrainingLevel, [string, string]> = {
    Beginner: ["06:00", "16:00"],
    Intermediate: ["07:00", "17:00"],
    Advanced: ["08:00", "18:00"],
    Adult: ["09:00", "19:00"],
  }
  return values[player.level][player.slotVariant]
}

async function seedAssignmentsAndAttendance(target: string) {
  const current = summaryFor(target)
  const assignedPlayers = players.filter((player) => player.finalState !== "unassigned")
  if (current.assignments === 0) {
    const read = openReadonly(target)
    const accounts = approvedPlayers(read)
    const series = seriesLookup(read)
    read.close()
    const { database, sessionService } = await applicationModules(target)
    const now = new Date(`${CANONICAL_DATE}T00:00:00+05:30`)
    players.forEach((player, index) => {
      if (player.finalState === "unassigned") return
      const seriesId = series.get(`${player.level}:${player.batch}:${slotTime(player)}`)
      if (!seriesId) throw new Error(`Missing schedule for ${player.level} ${player.batch}.`)
      sessionService.assignSessionRecords({
        coachId: COACH_ID,
        database,
        effectiveFrom: SCHEDULE_START,
        now,
        playerId: accounts[index].id,
        seriesId,
        weekdays: selectedWeekdays(player),
      })
    })
  } else if (current.assignments !== assignedPlayers.length) {
    throw new Error("Assignment stage is partial; prepare a fresh regression database.")
  }

  const attendanceSummary = summaryFor(target)
  if (attendanceSummary.attendance === 0) {
    const read = openReadonly(target)
    const rows = read.prepare(`
      select a.account_id as playerId, o.id as occurrenceId, o.occurrence_date as occurrenceDate
      from session_assignments a
      join session_assignment_weekdays w on w.assignment_id = a.id
      join session_occurrences o on o.series_id = a.series_id
      where o.occurrence_date between ? and ?
        and o.status = 'scheduled'
        and cast(strftime('%w', o.occurrence_date) as integer) = w.weekday
        and o.occurrence_date >= a.effective_from
        and (a.effective_to is null or o.occurrence_date < a.effective_to)
      order by a.account_id, o.occurrence_date, o.starts_at, o.id
    `).all(SCHEDULE_START, REPORT_REFERENCE_DATE) as Array<{
      occurrenceDate: string
      occurrenceId: string
      playerId: string
    }>
    read.close()
    const byPlayer = new Map<string, typeof rows>()
    rows.forEach((row) => byPlayer.set(row.playerId, [...(byPlayer.get(row.playerId) ?? []), row]))
    const changes = [...byPlayer.values()].flatMap((eligible) => eligible.flatMap((row, index) => {
      const position = index % 10
      if (position === 9) return []
      return [{
        playerId: row.playerId,
        occurrenceId: row.occurrenceId,
        choice: position === 8 ? "absent" as const : "present" as const,
        expectedChoice: "cleared" as const,
      }]
    }))
    const { database, sessionService } = await applicationModules(target)
    sessionService.saveSessionAttendanceRecords({
      changes,
      coachId: COACH_ID,
      database,
      now: new Date(`${REPORT_REFERENCE_DATE}T23:59:59+05:30`),
      referenceDate: REPORT_REFERENCE_DATE,
    })
  }

  {
    const read = openReadonly(target)
    const accounts = approvedPlayers(read)
    const activeAssignments = new Map((read.prepare(`
      select account_id as accountId, id from session_assignments where effective_to is null
    `).all() as Array<{ accountId: string; id: string }>).map((row) => [row.accountId, row.id]))
    read.close()
    const { database, memberService, sessionService } = await applicationModules(target)
    const now = new Date(`${CANONICAL_DATE}T12:00:00+05:30`)
    players.forEach((player, index) => {
      if (player.finalState !== "paused" && player.finalState !== "archived") return
      const account = accounts[index]
      const assignmentId = activeAssignments.get(account.id)
      if (assignmentId) {
        sessionService.endSessionAssignment({
          assignmentId,
          coachId: COACH_ID,
          database,
          effectiveTo: "2026-08-01",
          now,
        })
      }
      if (player.finalState === "archived") {
        const record = memberService.readCanonicalPlayerRecord(database, account.id)
        if (!record) return
        const result = memberService.archiveMemberRecord({
          coachId: COACH_ID,
          database,
          input: {
            memberId: account.id,
            expectedRevision: record.training.recordRevision,
          },
          now,
        })
        if (!result.ok) {
          const reason = result.code === "FINANCIAL_CLOSEOUT_REQUIRED"
            ? "financial closeout is required"
            : result.message
          throw new Error(`Could not archive fixture member: ${reason}`)
        }
      }
    })
  }
}

async function seedAttendanceAdjustmentExamples(target: string) {
  const current = summaryFor(target)
  if (current.attendanceAdjustments >= 2) return
  if (current.attendanceAdjustments !== 0) {
    throw new Error("Attendance-adjustment fixture is partial; prepare a fresh database.")
  }
  const read = openReadonly(target)
  const candidates = read.prepare(`
    select ar.account_id as playerId, ar.occurrence_id as sourceOccurrenceId,
      o.occurrence_date as sourceDate,
      (
        select candidate.id
        from session_occurrences candidate
        join session_attendance_records completion_attendance
          on completion_attendance.occurrence_id = candidate.id
          and completion_attendance.account_id = ar.account_id
          and completion_attendance.choice = 'present'
        where candidate.status = 'scheduled'
          and candidate.occurrence_date > o.occurrence_date
          and candidate.occurrence_date <= date(o.occurrence_date, '+14 days')
          and candidate.occurrence_date <= ?
          and exists (
            select 1
            from session_assignments assignment
            join session_assignment_weekdays assignment_day
              on assignment_day.assignment_id = assignment.id
            where assignment.account_id = ar.account_id
              and assignment.series_id = candidate.series_id
              and candidate.occurrence_date >= assignment.effective_from
              and (assignment.effective_to is null
                or candidate.occurrence_date < assignment.effective_to)
              and assignment_day.weekday = cast(strftime('%w', candidate.occurrence_date) as integer)
          )
        order by candidate.starts_at, candidate.id
        limit 1
      ) as completionOccurrenceId
    from session_attendance_records ar
    join session_occurrences o on o.id = ar.occurrence_id
    join accounts a on a.id = ar.account_id
    join academy_id_allocations x on x.account_id = ar.account_id
    where ar.choice = 'absent' and a.archived_at is null
      and o.occurrence_date >= '2026-07-20'
    order by o.occurrence_date desc, x.serial
  `).all(CANONICAL_DATE) as Array<{
    completionOccurrenceId: string | null
    playerId: string
    sourceDate: string
    sourceOccurrenceId: string
  }>
  read.close()
  const uniquePlayers = new Set<string>()
  const examples = candidates.filter((candidate) => {
    if (!candidate.completionOccurrenceId || uniquePlayers.has(candidate.playerId)) return false
    uniquePlayers.add(candidate.playerId)
    return true
  }).slice(0, 2)
  if (examples.length !== 2) {
    throw new Error(`${selectedProfile.key} fixture requires two eligible attendance absences.`)
  }
  const { attendanceAdjustments, database } = await applicationModules(target)
  const now = new Date(`${CANONICAL_DATE}T23:00:00+05:30`)
  const published = examples.map((example, index) => (
    attendanceAdjustments.publishMakeupAttendanceAdjustment({
      coachId: COACH_ID,
      completionOccurrenceId: example.completionOccurrenceId!,
      database,
      now,
      playerId: example.playerId,
      reason: index === 0 ? "Tournament recovery session" : "School examination",
      sourceOccurrenceId: example.sourceOccurrenceId,
    })
  ))
  attendanceAdjustments.voidAttendanceAdjustment({
    adjustmentId: published[1].id,
    coachId: COACH_ID,
    database,
    now,
  })
}

async function seedScheduleLifecycleExamples(target: string) {
  const read = openReadonly(target)
  const existing = read.prepare(`
    select
      sum(case when status = 'cancelled' then 1 else 0 end) as cancelled,
      sum(case when replacement_for_occurrence_id is not null then 1 else 0 end) as replacements
    from session_occurrences
  `).get() as { cancelled: number; replacements: number }
  if (existing.cancelled === 2 && existing.replacements === 1) {
    read.close()
    return
  }
  if (existing.cancelled || existing.replacements) {
    read.close()
    throw new Error("Schedule lifecycle fixture is partial; prepare a fresh database.")
  }
  const crossWeekdayReplacement = selectedProfile.key !== "demo"
  const candidateSql = crossWeekdayReplacement ? `
    select o.id, o.occurrence_date as occurrenceDate,
      o.duration_minutes as durationMinutes, o.venue
    from session_occurrences o
    join session_series s on s.id = o.series_id
    where o.status = 'scheduled'
      and o.occurrence_date >= '2026-08-05'
      and (
        s.batch = 'Weekend'
        or o.id = (
          select candidate.id
          from session_occurrences candidate
          join session_series candidate_series on candidate_series.id = candidate.series_id
          where candidate.status = 'scheduled'
            and candidate.occurrence_date >= '2026-08-05'
            and candidate_series.batch = 'Weekday'
          order by candidate.occurrence_date, candidate.starts_at, candidate.id
          limit 1
        )
      )
    order by case when s.batch = 'Weekday' then 0 else 1 end,
      o.occurrence_date, o.starts_at, o.id
    limit 2
  ` : `
    select id, occurrence_date as occurrenceDate, duration_minutes as durationMinutes,
      venue
    from session_occurrences
    where status = 'scheduled' and occurrence_date >= '2026-08-05'
    order by occurrence_date, starts_at, id
    limit 2
  `
  const candidates = read.prepare(candidateSql).all() as Array<{
    durationMinutes: number
    id: string
    occurrenceDate: string
    venue: string
  }>
  read.close()
  if (candidates.length !== 2) throw new Error("Schedule lifecycle examples need two future sessions.")
  const { database, sessionService } = await applicationModules(target)
  const now = new Date(`${CANONICAL_DATE}T08:00:00+05:30`)
  sessionService.cancelSessionOccurrence({
    coachId: COACH_ID,
    database,
    now,
    occurrenceId: candidates[0].id,
    referenceDate: CANONICAL_DATE,
  })
  sessionService.replaceSessionOccurrence({
    coachId: COACH_ID,
    database,
    dateKey: crossWeekdayReplacement ? "2026-08-12" : candidates[1].occurrenceDate,
    durationMinutes: candidates[1].durationMinutes,
    now,
    occurrenceId: candidates[1].id,
    referenceDate: CANONICAL_DATE,
    startTime: "11:30",
    venue: candidates[1].venue,
  })
}

function seedStaffAttendanceExamples(target: string) {
  if (!selectedProfile.juniorCoaches.length) return
  const db = new Database(target)
  db.pragma("foreign_keys = ON")
  try {
    if (!tableExists(db, "coach_profiles") || !tableExists(db, "staff_attendance_records")) {
      throw new Error("Junior-coach fixture requires the staff-attendance schema migration.")
    }
    if (tableCount(db, "staff_attendance_records") > 0) return
    const coaches = selectedProfile.juniorCoaches.map((definition) => {
      const account = db.prepare(`
        select id from accounts
        where role = 'coach' and approval_status = 'approved' and full_name = ?
      `).get(definition.fullName) as { id: string } | undefined
      if (!account) throw new Error(`Approved junior coach ${definition.fullName} is unavailable.`)
      return { ...definition, id: account.id }
    })
    const dates = Array.from({ length: 20 }, (_, index) => {
      const cursor = new Date(`${CANONICAL_DATE}T00:00:00.000Z`)
      cursor.setUTCDate(cursor.getUTCDate() - (19 - index))
      return cursor.toISOString().slice(0, 10)
    })
    const timestamp = Date.parse(`${CANONICAL_DATE}T12:00:00+05:30`)
    const insert = db.prepare(`
      insert into staff_attendance_records
        (id, coach_account_id, date_key, choice, marked_by_account_id, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?)
    `)
    db.transaction(() => {
      coaches.forEach((coach, coachIndex) => {
        dates.forEach((dateKey, dateIndex) => insert.run(
          `fixture-${selectedProfile.key}-staff-${coachIndex + 1}-${dateIndex + 1}`,
          coach.id,
          dateKey,
          coach.attendanceRate === 1 || (dateIndex + 1) % 4 !== 0 ? "present" : "absent",
          COACH_ID,
          timestamp,
          timestamp,
        ))
      })
      if (selectedProfile.key !== "demo") {
        insert.run(
          `fixture-${selectedProfile.key}-staff-cleared`,
          coaches[1].id,
          "2026-07-14",
          "cleared",
          COACH_ID,
          timestamp,
          timestamp,
        )
      }
    })()
  } finally {
    db.close()
  }
}

async function seedReports(target: string) {
  const current = summaryFor(target)
  const reportCount = selectedProfile.reportMix.drafts
  const publicationCount = selectedProfile.reportMix.published + 1
  if (current.reports === reportCount && current.publications === publicationCount) return
  if (current.reports || current.publications) {
    throw new Error("Report stage is partial; prepare a fresh regression database.")
  }
  process.env.DB_FILE_NAME = target
  const [{ getPlayerAttendanceInput }, { createAttendanceSnapshotV2 }] = await Promise.all([
    import("../../lib/attendance/database"),
    import("../../lib/attendance/domain"),
  ])
  const db = new Database(target)
  db.pragma("foreign_keys = ON")
  const accounts = approvedPlayers(db)
  const insertReport = db.prepare(`
    insert into monthly_reports
      (id, account_id, month, draft_text, updated_by_account_id, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?)
  `)
  const insertPublication = db.prepare(`
    insert into report_publications
      (id, report_id, revision, report_text, attendance_snapshot, published_by_account_id, published_at)
    values (?, ?, ?, ?, ?, ?, ?)
  `)
  const createdAt = Date.parse(`${REPORT_REFERENCE_DATE}T12:00:00+05:30`)
  const reportIndexes = Array.from({ length: reportCount }, (_, index) => index)
  if (reportIndexes.length > 0) {
    reportIndexes[reportIndexes.length - 1] = players.findIndex((player) => (
      player.finalState === "archived"
    ))
  }
  for (let reportIndex = 0; reportIndex < reportIndexes.length; reportIndex += 1) {
    const historicalReport = selectedProfile.key === "demo"
      ? representativeReportHistory[reportIndex - 1]
      : undefined
    const index = historicalReport ? 0 : reportIndexes[reportIndex]
    const player = players[index]
    const account = accounts[index]
    const reportId = randomUUID()
    const reportMonth = historicalReport?.month ?? REPORT_MONTH
    const reportReferenceDate = historicalReport
      ? new Date(Date.UTC(
          Number(reportMonth.slice(0, 4)),
          Number(reportMonth.slice(5, 7)),
          0,
        )).toISOString().slice(0, 10)
      : REPORT_REFERENCE_DATE
    const reportCreatedAt = historicalReport
      ? Date.parse(historicalReport.publishedAt)
      : createdAt
    const publishedText = historicalReport
      ? `${player.fullName} ${historicalReport.reportText}`
      : `${player.fullName} has trained with good attention this month. The most consistent progress has come from staying balanced through the first movement and recovering calmly after each shot.\n\nThe next step is to keep that same control when the rally becomes faster, without rushing the preparation.`
    const draftOnlyText = `${player.fullName} is becoming more composed through the weekly training rhythm. Movement quality is improving, and the focus now is to carry that consistency into longer rallies.`
    const isPublished = reportIndex < selectedProfile.reportMix.published
    const isRevision = isPublished
      && reportIndex >= selectedProfile.reportMix.published - selectedProfile.reportMix.revisionDrafts
    const draftText = isRevision
      ? `${publishedText}\n\nRevision note: the latest sessions show better patience under pressure.`
      : isPublished ? publishedText : draftOnlyText
    insertReport.run(
      reportId,
      account.id,
      reportMonth,
      draftText,
      COACH_ID,
      reportCreatedAt,
      reportCreatedAt,
    )
    if (isPublished) {
      const attendanceInput = getPlayerAttendanceInput(
        account.id,
        reportMonth,
        reportReferenceDate,
      )
      if (!attendanceInput) throw new Error(`Attendance input missing for ${player.fullName}.`)
      insertPublication.run(
        randomUUID(),
        reportId,
        1,
        publishedText,
        JSON.stringify(createAttendanceSnapshotV2(attendanceInput)),
        COACH_ID,
        reportCreatedAt,
      )
      if (reportIndex === 0) {
        insertPublication.run(
          randomUUID(),
          reportId,
          2,
          `${publishedText}\n\nFollow-up: movement recovery remained composed through the final week.`,
          JSON.stringify(createAttendanceSnapshotV2(attendanceInput)),
          COACH_ID,
          reportCreatedAt + 86_400_000,
        )
      }
    }
  }
  db.close()
}

function deterministicFeeReferenceGenerator() {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
  let counter = 0
  return () => {
    let value = counter
    let token = ""
    counter += 1
    for (let index = 0; index < 8; index += 1) {
      token = `${alphabet[value % alphabet.length]}${token}`
      value = Math.floor(value / alphabet.length)
    }
    return `SMBA-${token}`
  }
}

function deterministicFinanceMutationId(value: number) {
  return `00000000-0000-4000-8001-${String(value).padStart(12, "0")}`
}

const fixturePaymentMethods = [
  "cash",
  "upi",
  "bank_transfer",
  "card",
  "cheque",
  "other",
] as const

async function seedFinancials(target: string) {
  const {
    database,
    dbSchema,
    financeConfig,
    financeService,
  } = await applicationModules(target)
  const now = new Date(`${FINANCE_REFERENCE_DATE}T12:00:00+05:30`)
  const createFeeReference = deterministicFeeReferenceGenerator()
  const context = { coachId: COACH_ID, database, now, createFeeReference }
  const prefix = `fixture.${selectedProfile.key}.finance`

  financeService.activateFinance({
    trackingMonth: FINANCE_TRACKING_MONTH,
    idempotencyKey: `${prefix}.activate.2026-07`,
  }, context)

  const read = openReadonly(target)
  const accounts = approvedPlayers(read)
  read.close()
  const financePlayers = players.flatMap((player, index) => {
    if (player.finalState === "archived" || index === 6) return []
    return [{ account: accounts[index], player }]
  })
  financePlayers.forEach(({ account, player }) => {
    const agreedMonthlyFeePaise = financeConfig.defaultMonthlyFeePaise({
      academyPlan: player.academyPlan,
      batch: player.batch,
      level: player.level,
    })
    if (!agreedMonthlyFeePaise) {
      throw new Error(`Missing canonical fee for ${player.level} ${player.academyPlan}.`)
    }
    if (player.finalState === "active") {
      financeService.setupExistingPlayerFinance({
        playerId: account.id,
        academyPlan: player.academyPlan,
        level: player.level,
        batch: player.batch,
        agreedMonthlyFeePaise,
        effectiveFrom: SCHEDULE_START,
        monthlyDueDay: 5,
        registrationStatus: "pending",
        idempotencyKey: `${prefix}.setup.${account.serial}`,
      }, context)
      database.update(dbSchema.playerEnrollments).set({
        onboardingCompletedAt: now,
        onboardingCompletedByAccountId: COACH_ID,
      }).where(eq(dbSchema.playerEnrollments.accountId, account.id)).run()
      return
    }

    // Paused and unassigned rows intentionally model imported Fee Plans that
    // are awaiting a current/future assignment. Seed those historical facts
    // directly; the guarded coach workflow must never manufacture this state.
    const existingAgreement = database.select({ id: dbSchema.feeAgreements.id })
      .from(dbSchema.feeAgreements)
      .where(eq(dbSchema.feeAgreements.playerAccountId, account.id))
      .get()
    const agreementId = existingAgreement?.id
      ?? `fixture-${selectedProfile.key}-legacy-agreement-${account.serial}`
    if (!existingAgreement) {
      database.insert(dbSchema.feeAgreements).values({
        id: agreementId,
        playerAccountId: account.id,
        academyPlan: player.academyPlan,
        level: player.level,
        batch: player.batch,
        agreedMonthlyFeePaise,
        currency: "INR",
        monthlyDueDay: 5,
        effectiveFrom: SCHEDULE_START,
        effectiveTo: null,
        status: "active",
        recordRevision: 0,
        createdByAccountId: COACH_ID,
        createdAt: now,
        updatedByAccountId: COACH_ID,
        updatedAt: now,
      }).run()
    }

    const existingRegistration = database.select({ id: dbSchema.financialCharges.id })
      .from(dbSchema.financialCharges)
      .where(and(
        eq(dbSchema.financialCharges.playerAccountId, account.id),
        eq(dbSchema.financialCharges.type, "registration"),
        eq(dbSchema.financialCharges.lifecycle, "issued"),
      )).get()
    if (!existingRegistration) {
      database.insert(dbSchema.financialCharges).values({
        id: `fixture-${selectedProfile.key}-legacy-registration-${account.serial}`,
        feeReference: createFeeReference(),
        playerAccountId: account.id,
        feeAgreementId: null,
        type: "registration",
        billingPeriod: null,
        description: "SMBA registration fee",
        originalAmountPaise: 100_000,
        currency: "INR",
        dueDate: SCHEDULE_START,
        lifecycle: "issued",
        recordRevision: 0,
        issuedByAccountId: COACH_ID,
        issuedAt: now,
      }).run()
    }
    if (player.finalState === "paused") {
      database.update(dbSchema.playerEnrollments).set({
        onboardingCompletedAt: now,
        onboardingCompletedByAccountId: COACH_ID,
      }).where(eq(dbSchema.playerEnrollments.accountId, account.id)).run()
    }
  })

  financeService.prepareMonthlyCharges({
    period: FINANCE_TRACKING_MONTH,
    idempotencyKey: `${prefix}.prepare.2026-07`,
  }, context)

  const historyRead = openReadonly(target)
  const historicalCharges = historyRead.prepare(`
    select c.id, c.original_amount_paise as originalAmountPaise,
      c.record_revision as recordRevision, c.type, x.serial
    from financial_charges c
    join academy_id_allocations x on x.account_id = c.player_account_id
    where c.lifecycle = 'issued'
      and (c.type = 'registration'
        or (c.type = 'monthly_training' and c.billing_period = ?))
    order by x.serial, case c.type when 'registration' then 0 else 1 end
  `).all(FINANCE_TRACKING_MONTH) as Array<{
    id: string
    originalAmountPaise: number
    recordRevision: number
    serial: number
    type: "registration" | "monthly_training"
  }>
  historyRead.close()
  historicalCharges.forEach((charge, index) => {
    if (charge.type === "registration" && index === 0) return
    const method = fixturePaymentMethods[index % fixturePaymentMethods.length]
    financeService.recordPayment({
      chargeId: charge.id,
      expectedChargeRevision: charge.recordRevision,
      amountPaise: charge.originalAmountPaise,
      receivedOn: charge.type === "registration" ? "2026-07-02" : "2026-07-05",
      method,
      externalReference: method === "cash" ? undefined : `HISTORY-${charge.serial}`,
      internalNote: "Deterministic portal payment history",
      idempotencyKey: `${prefix}.history.${charge.type}.${charge.serial}`,
    }, context)
  })

  financeService.prepareMonthlyCharges({
    period: CURRENT_FEE_PERIOD,
    idempotencyKey: `${prefix}.prepare.2026-08`,
  }, context)

  const augustRead = openReadonly(target)
  const augustCharges = augustRead.prepare(`
    select c.id, c.original_amount_paise as originalAmountPaise,
      c.record_revision as recordRevision, x.serial
    from financial_charges c
    join academy_id_allocations x on x.account_id = c.player_account_id
    where c.type = 'monthly_training' and c.billing_period = ? and c.lifecycle = 'issued'
    order by x.serial
  `).all(CURRENT_FEE_PERIOD) as Array<{
    id: string
    originalAmountPaise: number
    recordRevision: number
    serial: number
  }>
  const existingPaymentKeys = new Set((augustRead.prepare(`
    select idempotency_key as idempotencyKey
    from payments
    where idempotency_key like ?
  `).all(`${prefix}.payment.2026-08.%`) as Array<{ idempotencyKey: string }>)
    .map((row) => row.idempotencyKey))
  augustRead.close()
  const fullPaymentCount = selectedProfile.key === "stress" ? 55
    : selectedProfile.key === "demo" ? 20 : 12
  const partialPaymentCount = selectedProfile.key === "stress" ? 15
    : selectedProfile.key === "demo" ? 7 : 5
  augustCharges.slice(0, fullPaymentCount + partialPaymentCount).forEach((charge, index) => {
    const idempotencyKey = `${prefix}.payment.2026-08.${charge.serial}`
    // The fixture is declarative. A second seed pass preserves the original
    // receipt command (including its historical revision token) rather than
    // reconstructing a different retry from the charge's newer revision.
    if (existingPaymentKeys.has(idempotencyKey)) return
    const method = fixturePaymentMethods[index % fixturePaymentMethods.length]
    financeService.recordPayment({
      chargeId: charge.id,
      expectedChargeRevision: charge.recordRevision,
      amountPaise: index < fullPaymentCount
        ? charge.originalAmountPaise
        : Math.floor(charge.originalAmountPaise / 2),
      receivedOn: FINANCE_REFERENCE_DATE,
      method,
      externalReference: method === "cash" ? undefined : `FIXTURE-${charge.serial}`,
      internalNote: `Deterministic ${selectedProfile.key} fixture`,
      idempotencyKey,
    }, context)
  })

  const mutationOffset = selectedProfile.key === "stress" ? 1_000
    : selectedProfile.key === "demo" ? 2_000 : 3_000
  const mutationId = (value: number) => deterministicFinanceMutationId(mutationOffset + value)

  // A small immutable lifecycle set keeps each profile operationally useful.
  const phaseThreeRead = openReadonly(target)
  const refundablePayments = phaseThreeRead.prepare(`
    select p.id as paymentId, pa.id as allocationId
    from payments p
    join payment_allocations pa on pa.payment_id = p.id
    join financial_charges c on c.id = pa.charge_id
    join academy_id_allocations x on x.account_id = p.player_account_id
    where p.idempotency_key like ? and p.lifecycle = 'recorded'
      and c.type = 'monthly_training' and c.billing_period = ?
      and c.fee_agreement_id is not null
      and pa.amount_paise = c.original_amount_paise
    order by x.serial desc
    limit 2
  `).all(`${prefix}.payment.2026-08.%`, CURRENT_FEE_PERIOD) as Array<{
    allocationId: string
    paymentId: string
  }>
  const concessionTargets = phaseThreeRead.prepare(`
    select c.id as chargeId, c.player_account_id as playerId, x.serial
    from financial_charges c
    join academy_id_allocations x on x.account_id = c.player_account_id
    where c.type = 'monthly_training' and c.billing_period = ?
      and c.lifecycle = 'issued'
      and not exists (
        select 1 from payment_allocations pa where pa.charge_id = c.id
      )
    order by x.serial
    limit 2
  `).all(CURRENT_FEE_PERIOD) as Array<{
    chargeId: string
    playerId: string
    serial: number
  }>
  const restartTarget = phaseThreeRead.prepare(`
    select a.id as agreementId, a.player_account_id as playerId,
      a.academy_plan as academyPlan,
      a.level, a.batch, a.agreed_monthly_fee_paise as agreedMonthlyFeePaise,
      a.monthly_due_day as monthlyDueDay
    from fee_agreements a
    join academy_id_allocations x on x.account_id = a.player_account_id
    where a.effective_from = ?
    order by x.serial desc
    limit 1
  `).get(SCHEDULE_START) as {
    academyPlan: AcademyPlan
    agreedMonthlyFeePaise: number
    agreementId: string
    batch: TrainingBatch
    level: TrainingLevel
    monthlyDueDay: number
    playerId: string
  } | undefined
  const includeAdvancedCorrections = selectedProfile.key !== "demo"
  const reversalTarget = includeAdvancedCorrections ? phaseThreeRead.prepare(`
    select p.id as paymentId, p.amount_paise as amountPaise, c.id as chargeId
    from payments p
    join payment_allocations pa on pa.payment_id = p.id
    join financial_charges c on c.id = pa.charge_id
    join academy_id_allocations x on x.account_id = p.player_account_id
    where p.idempotency_key like ?
    order by x.serial
    limit 1 offset 2
  `).get(`${prefix}.payment.2026-08.%`) as {
    amountPaise: number
    chargeId: string
    paymentId: string
  } | undefined : undefined
  const correctionTargets = includeAdvancedCorrections ? phaseThreeRead.prepare(`
    select c.id as chargeId
    from financial_charges c
    join academy_id_allocations x on x.account_id = c.player_account_id
    where c.type = 'monthly_training' and c.billing_period = ? and c.lifecycle = 'issued'
      and not exists (select 1 from payment_allocations pa where pa.charge_id = c.id)
    order by x.serial
    limit 2 offset 2
  `).all(CURRENT_FEE_PERIOD) as Array<{ chargeId: string }> : []
  phaseThreeRead.close()

  if (refundablePayments.length !== 2) {
    throw new Error(`${selectedProfile.key} fixture requires two deterministic paid receipts.`)
  }
  const recordedRefunds = refundablePayments.map((payment, index) => financeService.recordRefund({
    paymentId: payment.paymentId,
    // Both source receipts begin at revision zero. Reusing the original token
    // is required for an identical idempotent command on later seed passes.
    expectedPaymentRevision: 0,
    expectedChargeRevision: 1,
    expectedAgreementRevision: 0,
    amountPaise: index === 0 ? 50_000 : 25_000,
    withdrawalEffectiveOn: FINANCE_REFERENCE_DATE,
    refundedOn: FINANCE_REFERENCE_DATE,
    method: index === 0 ? "upi" : "cash",
    externalReference: index === 0 ? `${selectedProfile.key.toUpperCase()}-REFUND` : undefined,
    internalNote: `Deterministic ${selectedProfile.key} Refund fixture`,
    allocations: [{
      paymentAllocationId: payment.allocationId,
      amountPaise: index === 0 ? 50_000 : 25_000,
    }],
    mutationId: mutationId(100 + index),
  }, context))
  financeService.reverseRefund({
    refundId: recordedRefunds[1].refund.id,
    expectedRefundRevision: 0,
    reason: "Deterministic reversed Refund fixture",
    mutationId: mutationId(102),
  }, context)

  if (concessionTargets.length !== 2) {
    throw new Error(`${selectedProfile.key} fixture requires two deterministic unpaid Charges.`)
  }
  const activeConcession = financeService.createConcession({
    playerId: concessionTargets[0].playerId,
    mode: "recurring",
    valueKind: "fixed",
    value: 50_000,
    startsPeriod: CURRENT_FEE_PERIOD,
    endsPeriod: "2026-09",
    reason: "Deterministic academy concession",
    mutationId: mutationId(103),
  }, context)
  financeService.applyConcession({
    concessionId: activeConcession.concession.id,
    chargeId: concessionTargets[0].chargeId,
    expectedConcessionRevision: 0,
    expectedChargeRevision: 0,
    mutationId: mutationId(104),
  }, context)

  const reversedConcession = financeService.createConcession({
    playerId: concessionTargets[1].playerId,
    mode: "one_off",
    valueKind: "fixed",
    value: 25_000,
    reason: "Deterministic reversed concession",
    mutationId: mutationId(105),
  }, context)
  const reversedApplication = financeService.applyConcession({
    concessionId: reversedConcession.concession.id,
    chargeId: concessionTargets[1].chargeId,
    expectedConcessionRevision: 0,
    expectedChargeRevision: 0,
    mutationId: mutationId(106),
  }, context)
  financeService.reverseConcessionApplication({
    applicationId: reversedApplication.applicationId,
    reason: "Deterministic reversed Concession application fixture",
    mutationId: mutationId(107),
  }, context)
  financeService.reverseConcession({
    concessionId: reversedConcession.concession.id,
    expectedConcessionRevision: 2,
    reason: "Deterministic reversed Concession fixture",
    mutationId: mutationId(108),
  }, context)

  if (!restartTarget) {
    throw new Error(`${selectedProfile.key} fixture requires a Fee Plan lifecycle target.`)
  }
  financeService.endFeeAgreement({
    agreementId: restartTarget.agreementId,
    effectiveThroughPeriod: CURRENT_FEE_PERIOD,
    reason: "Deterministic end-and-restart lifecycle fixture",
    expectedRevision: 0,
    idempotencyKey: `${prefix}.fee-plan-end`,
  }, context)
  financeService.createOrReplaceFeeAgreement({
    playerId: restartTarget.playerId,
    academyPlan: restartTarget.academyPlan,
    level: restartTarget.level,
    batch: restartTarget.batch,
    agreedMonthlyFeePaise: restartTarget.agreedMonthlyFeePaise,
    effectiveFrom: "2026-09-01",
    monthlyDueDay: restartTarget.monthlyDueDay,
    idempotencyKey: `${prefix}.fee-plan-restart`,
  }, context)

  if (includeAdvancedCorrections) {
    if (!reversalTarget || correctionTargets.length !== 2) {
      throw new Error(`${selectedProfile.key} fixture requires Payment replacement and correction targets.`)
    }
    const reversedCharge = financeService.reversePayment({
      paymentId: reversalTarget.paymentId,
      reason: "Recorded against the wrong receipt reference",
      idempotencyKey: `${prefix}.payment-reversal`,
    }, context)
    financeService.recordPayment({
      chargeId: reversalTarget.chargeId,
      expectedChargeRevision: reversedCharge.recordRevision,
      amountPaise: reversalTarget.amountPaise,
      receivedOn: FINANCE_REFERENCE_DATE,
      method: "upi",
      externalReference: `${selectedProfile.key.toUpperCase()}-REPLACEMENT`,
      internalNote: "Replacement for reversed fixture receipt",
      idempotencyKey: `${prefix}.payment-replacement`,
    }, context)
    financeService.applyChargeAdjustment({
      chargeId: correctionTargets[0].chargeId,
      kind: "manual_credit",
      amountPaise: 10_000,
      reason: "Approved rounding correction",
      idempotencyKey: `${prefix}.manual-credit`,
    }, context)
    financeService.applyChargeAdjustment({
      chargeId: correctionTargets[1].chargeId,
      kind: "manual_debit",
      amountPaise: 5_000,
      reason: "Corrected academy fee entry",
      idempotencyKey: `${prefix}.manual-debit`,
    }, context)
  }
}

function deterministicAnnouncementUuid(scope: "8002" | "8003" | "8004", value: number) {
  return `00000000-0000-4000-${scope}-${String(value).padStart(12, "0")}`
}

async function seedAnnouncementExamples(target: string) {
  if (selectedProfile.key !== "stress") return
  const current = summaryFor(target)
  if (current.announcements === 5
    && current.announcementChannels === 7
    && current.announcementWithdrawals === 1) return
  if (current.announcements || current.announcementChannels || current.announcementWithdrawals) {
    throw new Error("Announcement fixture is partial; prepare a fresh database.")
  }

  const { announcementService, database } = await applicationModules(target)
  const definitions = [
    {
      channels: ["homepage", "player_dashboard"] as const,
      content: "August training continues on the regular academy timetable. Please arrive ten minutes early so warm-up can begin before the court session.",
      expiresOn: "2026-08-31",
      pinAfterPublication: true,
      publishedOn: "2026-08-01",
      title: "August training update",
      withdraw: false,
    },
    {
      channels: ["homepage"] as const,
      content: "Free trial sessions are available in the morning and evening batches. Contact the academy before visiting so the coach can confirm a suitable court time.",
      expiresOn: null,
      pinAfterPublication: false,
      publishedOn: "2026-08-02",
      title: "Free trial court timings for new players joining morning and evening academy batches",
      withdraw: false,
    },
    {
      channels: ["player_dashboard"] as const,
      content: "Members are invited to a focused movement and recovery workshop this month. Bring your regular kit, water bottle, and training journal.",
      expiresOn: "2026-08-20",
      pinAfterPublication: false,
      publishedOn: "2026-08-03",
      title: "Player development workshop",
      withdraw: false,
    },
    {
      channels: ["homepage", "player_dashboard"] as const,
      content: "Court maintenance was completed during the July closure. Regular training resumed after the published maintenance window.",
      expiresOn: "2026-07-15",
      pinAfterPublication: false,
      publishedOn: "2026-07-01",
      title: "July court maintenance",
      withdraw: false,
    },
    {
      channels: ["player_dashboard"] as const,
      content: "The Sunday tournament briefing is no longer required. Updated competition information will be shared separately if needed.",
      expiresOn: null,
      pinAfterPublication: false,
      publishedOn: "2026-08-02",
      title: "Sunday tournament briefing",
      withdraw: true,
    },
  ]

  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index]
    const publication = await announcementService.publishAnnouncement({
      channels: definition.channels,
      content: definition.content,
      expiresOn: definition.expiresOn,
      pinned: false,
      publicationKey: deterministicAnnouncementUuid("8002", index + 1),
      title: definition.title,
    }, {
      coachId: COACH_ID,
      createId: () => deterministicAnnouncementUuid("8003", index + 1),
      database,
      now: new Date(`${definition.publishedOn}T09:00:00+05:30`),
    })

    if (definition.pinAfterPublication) {
      await announcementService.setAnnouncementPinned({
        announcementId: publication.announcement.id,
        expectedPresentationRevision: 0,
        pinned: true,
      }, {
        coachId: COACH_ID,
        database,
        now: new Date("2026-08-02T09:00:00+05:30"),
      })
    }

    if (definition.withdraw) {
      await announcementService.withdrawAnnouncement({
        announcementId: publication.announcement.id,
        reason: "Event timing changed after publication",
      }, {
        coachId: COACH_ID,
        createId: () => deterministicAnnouncementUuid("8004", index + 1),
        database,
        now: new Date("2026-08-03T10:00:00+05:30"),
      })
    }
  }
}

async function seedLoaded(target: string) {
  const current = summaryFor(target)
  if (current.series !== schedules.length || current.players !== players.length) {
    throw new Error("Loaded stage requires completed enrollment and schedule stages.")
  }
  await seedAssignmentsAndAttendance(target)
  await seedAttendanceAdjustmentExamples(target)
  await seedScheduleLifecycleExamples(target)
  seedStaffAttendanceExamples(target)
  await seedReports(target)
  await seedFinancials(target)
  await seedAnnouncementExamples(target)
  return verify(target, "loaded")
}

async function seedToStage(target: string, stage: Stage) {
  assertRegressionTarget(target)
  if (!fs.existsSync(target)) throw new Error("Prepare the regression database before seeding it.")
  // An existing regression database may predate the latest schema. Run the
  // application migrations before any stage shortcut calls verify(), so an
  // already-loaded fixture can be upgraded in place without being rebuilt.
  await applicationModules(target)
  if (stage === "default") return verify(target, "default")
  await seedRegistrations(target)
  if (stage === "registrations") return verify(target, stage)
  await seedEnrollments(target)
  if (stage === "enrollments") return verify(target, stage)
  await seedSchedules(target)
  if (stage === "schedules") return verify(target, stage)
  return seedLoaded(target)
}

function summaryFor(target: string) {
  const db = openReadonly(target)
  try {
    const scalar = (sql: string) => (db.prepare(sql).get() as { count: number }).count
    return {
      accounts: tableCount(db, "accounts"),
      assignments: tableCount(db, "session_assignments"),
      assignmentWeekdays: tableCount(db, "session_assignment_weekdays"),
      attendance: tableCount(db, "session_attendance_records"),
      attendanceAdjustments: tableCount(db, "attendance_adjustments"),
      occurrences: tableCount(db, "session_occurrences"),
      pending: scalar("select count(*) as count from accounts where approval_status = 'pending'"),
      players: tableCount(db, "player_enrollments"),
      publications: tableCount(db, "report_publications"),
      recurrenceRules: tableCount(db, "session_recurrence_rules"),
      reports: tableCount(db, "monthly_reports"),
      series: tableCount(db, "session_series"),
      feeAgreements: safeTableCount(db, "fee_agreements"),
      financialCharges: safeTableCount(db, "financial_charges"),
      payments: safeTableCount(db, "payments"),
      paymentAllocations: safeTableCount(db, "payment_allocations"),
      refunds: safeTableCount(db, "refunds"),
      refundAllocations: safeTableCount(db, "refund_allocations"),
      concessions: safeTableCount(db, "concessions"),
      concessionApplications: safeTableCount(db, "concession_applications"),
      financeReferenceSequences: safeTableCount(db, "finance_reference_sequences"),
      chargeAdjustments: safeTableCount(db, "charge_adjustments"),
      financialAuditEvents: safeTableCount(db, "financial_audit_events"),
      coachProfiles: safeTableCount(db, "coach_profiles"),
      staffAttendance: safeTableCount(db, "staff_attendance_records"),
      announcements: safeTableCount(db, "broadcasts"),
      announcementChannels: safeTableCount(db, "broadcast_channels"),
      announcementWithdrawals: safeTableCount(db, "broadcast_withdrawals"),
      authUsers: safeTableCount(db, "auth_users"),
      activeCredentials: tableExists(db, "auth_credential_states")
        ? scalar("select count(*) as count from auth_credential_states where status = 'active'")
        : 0,
      revokedCredentials: tableExists(db, "auth_credential_states")
        ? scalar("select count(*) as count from auth_credential_states where status = 'revoked'")
        : 0,
    }
  } finally {
    db.close()
  }
}

function logicalChecksum(db: Database.Database) {
  const ids = new Map<string, string>()
  const playersByAcademyId = db.prepare(`
    select a.id, m.identifier,
      a.full_name as fullName, e.level, e.batch,
      e.academy_plan as academyPlan, e.status,
      case when a.archived_at is null then 0 else 1 end as archived
    from accounts a
    join academy_id_allocations x on x.account_id = a.id
    join auth_methods m on m.account_id = a.id and m.revoked_at is null
    left join player_enrollments e on e.account_id = a.id
    order by x.serial
  `).all() as Array<Record<string, unknown> & { id: string; identifier: string }>
  playersByAcademyId.forEach((row) => ids.set(row.id, row.identifier))
  const series = db.prepare(`
    select s.id, s.programme, s.batch, s.venue, s.starts_on as startsOn,
      s.ends_on as endsOn, r.weekday, r.start_time as startTime,
      r.duration_minutes as durationMinutes
    from session_series s
    join session_recurrence_rules r on r.series_id = s.id
    order by s.programme, s.batch, r.start_time, r.weekday
  `).all() as Array<Record<string, unknown> & { id: string }>
  const seriesKeys = new Map<string, string>()
  series.forEach((row) => {
    seriesKeys.set(row.id, `${row.programme}:${row.batch}:${row.startTime}`)
  })
  const assignmentRows = db.prepare(`
    select a.account_id as accountId, a.series_id as seriesId, a.effective_from as effectiveFrom,
      group_concat(w.weekday, ',') as weekdays
    from session_assignments a
    join session_assignment_weekdays w on w.assignment_id = a.id
    group by a.id
  `).all() as Array<{ accountId: string; effectiveFrom: string; seriesId: string; weekdays: string }>
  const assignments = assignmentRows.map((row) => ({
      academyId: ids.get(row.accountId),
      series: seriesKeys.get(row.seriesId),
      effectiveFrom: row.effectiveFrom,
      weekdays: row.weekdays.split(",").map(Number).sort((a, b) => a - b),
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  const attendance = db.prepare(`
    select m.identifier as academyId, o.occurrence_date as occurrenceDate,
      s.programme, s.batch, r.start_time as startTime, ar.choice
    from session_attendance_records ar
    join auth_methods m on m.account_id = ar.account_id and m.revoked_at is null
    join session_occurrences o on o.id = ar.occurrence_id
    join session_series s on s.id = o.series_id
    join session_recurrence_rules r on r.series_id = s.id
      and r.weekday = cast(strftime('%w', o.occurrence_date) as integer)
    order by m.identifier, o.occurrence_date, startTime
  `).all()
  const reports = db.prepare(`
    select m.identifier as academyId,
      r.month, r.draft_text as draftText,
      p.report_text as publishedText, p.revision
    from monthly_reports r
    join academy_id_allocations x on x.account_id = r.account_id
    join auth_methods m on m.account_id = r.account_id and m.revoked_at is null
    left join report_publications p on p.report_id = r.id
    order by x.serial, r.month, p.revision
  `).all()
  const registrations = db.prepare(`
    select full_name as fullName, requested_role as requestedRole,
      approval_status as approvalStatus
    from accounts
    where approval_status = 'pending'
    order by full_name, requested_role
  `).all()
  const sessionLifecycle = db.prepare(`
    select s.programme, s.batch, o.occurrence_date as occurrenceDate,
      time(o.starts_at / 1000, 'unixepoch') as startTime,
      o.status,
      case when o.replacement_for_occurrence_id is null then 0 else 1 end as replacement
    from session_occurrences o
    join session_series s on s.id = o.series_id
    where o.status <> 'scheduled' or o.replacement_for_occurrence_id is not null
    order by occurrenceDate, startTime, s.programme, s.batch
  `).all()
  const coachAccess = tableExists(db, "coach_profiles") ? db.prepare(`
    select m.identifier as academyId,
      p.access_level as accessLevel, p.joined_on as joinedOn
    from coach_profiles p
    join academy_id_allocations x on x.account_id = p.account_id
    join auth_methods m on m.account_id = p.account_id and m.revoked_at is null
    order by x.serial
  `).all() : []
  const staffAttendance = tableExists(db, "staff_attendance_records") ? db.prepare(`
    select m.identifier as academyId, r.date_key as dateKey, r.choice
    from staff_attendance_records r
    join academy_id_allocations x on x.account_id = r.coach_account_id
    join auth_methods m on m.account_id = r.coach_account_id and m.revoked_at is null
    order by x.serial, r.date_key
  `).all() : []
  const adjustments = db.prepare(`
    select m.identifier as academyId, o.occurrence_date as sourceDate,
      a.completed_on as completedOn, a.reason,
      case when a.voided_at is null then 0 else 1 end as voided,
      case when a.review_required_at is null then 0 else 1 end as reviewRequired
    from attendance_adjustments a
    join auth_methods m on m.account_id = a.player_account_id and m.revoked_at is null
    join session_occurrences o on o.id = a.source_occurrence_id
    order by m.identifier, sourceDate, completedOn
  `).all()
  const announcements = tableExists(db, "broadcasts") ? db.prepare(`
    select b.title, b.content, b.published_at as publishedAt,
      b.expires_on as expiresOn, b.pinned,
      b.presentation_revision as presentationRevision,
      (
        select group_concat(ordered.channel, ',')
        from (
          select c.channel
          from broadcast_channels c
          where c.broadcast_id = b.id
          order by c.channel
        ) ordered
      ) as channels,
      w.reason as withdrawalReason,
      w.withdrawn_at as withdrawnAt
    from broadcasts b
    left join broadcast_withdrawals w on w.broadcast_id = b.id
    order by b.published_at, b.title
  `).all() : []
  const finance = tableExists(db, "financial_charges") ? {
    activation: db.prepare(`
      select event_type as eventType, entity_type as entityType, entity_id as entityId,
        idempotency_key as idempotencyKey, metadata
      from financial_audit_events
      where event_type = 'finance_activated'
      order by entity_id
    `).all(),
    agreements: db.prepare(`
      select m.identifier as academyId, a.academy_plan as academyPlan, a.level, a.batch,
        a.agreed_monthly_fee_paise as agreedMonthlyFeePaise, a.monthly_due_day as monthlyDueDay,
        a.effective_from as effectiveFrom, a.effective_to as effectiveTo, a.status
      from fee_agreements a
      join auth_methods m on m.account_id = a.player_account_id and m.revoked_at is null
      order by m.identifier, a.effective_from
    `).all(),
    charges: db.prepare(`
      select m.identifier as academyId, c.fee_reference as feeReference, c.type,
        c.billing_period as billingPeriod, c.original_amount_paise as originalAmountPaise,
        c.due_date as dueDate, c.lifecycle
      from financial_charges c
      join auth_methods m on m.account_id = c.player_account_id and m.revoked_at is null
      order by m.identifier, c.type, c.billing_period, c.fee_reference
    `).all(),
    payments: db.prepare(`
      select m.identifier as academyId, p.receipt_reference as receiptReference,
        p.amount_paise as amountPaise, p.received_on as receivedOn, p.method,
        p.external_reference as externalReference, p.lifecycle
      from payments p
      join auth_methods m on m.account_id = p.player_account_id and m.revoked_at is null
      order by m.identifier, p.received_on, p.receipt_reference
    `).all(),
    paymentAllocations: db.prepare(`
      select m.identifier as academyId, p.receipt_reference as receiptReference,
        c.fee_reference as feeReference, a.amount_paise as amountPaise
      from payment_allocations a
      join payments p on p.id = a.payment_id
      join financial_charges c on c.id = a.charge_id
      join auth_methods m on m.account_id = p.player_account_id and m.revoked_at is null
      order by m.identifier, p.receipt_reference, c.fee_reference
    `).all(),
    adjustments: db.prepare(`
      select m.identifier as academyId, c.fee_reference as feeReference,
        a.kind, a.amount_paise as amountPaise, a.reason,
        case when a.reversed_at is null then 0 else 1 end as reversed
      from charge_adjustments a
      join financial_charges c on c.id = a.charge_id
      join auth_methods m on m.account_id = c.player_account_id and m.revoked_at is null
      order by m.identifier, c.fee_reference, a.kind
    `).all(),
  } : { activation: [], agreements: [], charges: [], payments: [], adjustments: [] }
  const normalizedPlayers = playersByAcademyId.map((row) => {
    const normalized: Record<string, unknown> = { ...row }
    delete normalized.id
    return normalized
  })
  const normalizedSeries = series.map((row) => {
    const normalized: Record<string, unknown> = { ...row }
    delete normalized.id
    return normalized
  })
  return createHash("sha256").update(JSON.stringify({
    players: normalizedPlayers,
    series: normalizedSeries,
    assignments,
    attendance,
    registrations,
    sessionLifecycle,
    reports,
    adjustments,
    announcements,
    coachAccess,
    staffAttendance,
    finance,
  })).digest("hex")
}

function verify(target: string, expectedStage?: Stage) {
  assertRegressionTarget(target)
  const db = openReadonly(target)
  try {
    const schema = verifyFixtureSchema(db)
    const integrity = verifyDatabaseIntegrity(db)
    const summary = summaryFor(target)
    const problems: string[] = []
    const registrationStageCount = players.length
      + selectedProfile.juniorCoaches.length
      + selectedProfile.pendingPlayerNames.length
    const approvedAccountCount = 1 + selectedProfile.juniorCoaches.length + players.length
    const loadedAccountCount = approvedAccountCount + selectedProfile.pendingPlayerNames.length
    const expectedAssignments = players.filter((player) => player.finalState !== "unassigned").length
    const expectedActiveAssignments = players.filter((player) => player.finalState === "active").length
    const expectedReports = selectedProfile.reportMix.drafts
    const expectedPublications = selectedProfile.reportMix.published + 1
    const financePlayerCount = players.filter((player, index) => (
      player.finalState !== "archived"
      && index !== 6
    )).length
    const augustFinancePlayerCount = players.filter((player, index) => (
      player.finalState === "active"
      && index !== 6
    )).length
    const julyFinancePlayerCount = players.filter((player, index) => (
      player.finalState !== "archived"
      && player.finalState !== "unassigned"
      && index !== 6
    )).length
    const stage = expectedStage ?? (
      summary.financialCharges > 0 ? "loaded"
        : summary.series === schedules.length ? "schedules"
          : summary.players === players.length ? "enrollments"
            : summary.pending === registrationStageCount ? "registrations"
              : "default"
    )
    if (tableCount(db, "batches") !== 8) problems.push("Eight reference batches must remain available.")
    const coach = db.prepare(`select count(*) as count from auth_methods where identifier = ?`).get(COACH_ACADEMY_ID) as { count: number }
    if (coach.count !== 1) problems.push(`The seed coach must remain ${COACH_ACADEMY_ID}.`)
    if (stage === "default" && (summary.accounts !== 1 || summary.players || summary.series)) {
      problems.push("Default stage must contain only the coach and reference batches.")
    }
    const expectedCredentialAccounts = ["enrollments", "schedules", "loaded"].includes(stage)
      ? approvedAccountCount
      : 1
    const expectedRevokedCredentials = stage === "loaded" ? 1 : 0
    if (summary.authUsers !== expectedCredentialAccounts
      || summary.activeCredentials !== expectedCredentialAccounts - expectedRevokedCredentials
      || summary.revokedCredentials !== expectedRevokedCredentials) {
      problems.push(
        `Auth fixtures must contain ${expectedCredentialAccounts} credential users, ${expectedCredentialAccounts - expectedRevokedCredentials} active and ${expectedRevokedCredentials} revoked credentials.`,
      )
    }
    if (stage === "registrations"
      && (summary.pending !== registrationStageCount || summary.players !== 0)) {
      problems.push(`Registration stage must contain ${registrationStageCount} pending accounts.`)
    }
    if (["enrollments", "schedules", "loaded"].includes(stage)) {
      if (summary.players !== players.length
        || summary.pending !== selectedProfile.pendingPlayerNames.length
        || summary.accounts !== loadedAccountCount) {
        problems.push(
          `Approved stages must contain ${approvedAccountCount} approved accounts and ${selectedProfile.pendingPlayerNames.length} pending players.`,
        )
      }
      const identifiers = db.prepare(`
        select identifier from auth_methods order by identifier
      `).all() as Array<{ identifier: string }>
      const expected = [
        COACH_ACADEMY_ID,
        ...selectedProfile.juniorCoaches.map((_, index) => (
          formatAcademyId(ACADEMY_ID_SERIAL_RANGES.juniorCoach.first + index)
        )),
        ...players.map((_, index) => (
          formatAcademyId(ACADEMY_ID_SERIAL_RANGES.player.first + index)
        )),
      ].sort()
      if (identifiers.map((row) => row.identifier).join("|") !== expected.join("|")) {
        problems.push("Approved Academy IDs do not match the deterministic role-prefixed sequence.")
      }
      if (summary.coachProfiles !== 1 + selectedProfile.juniorCoaches.length) {
        problems.push("Every approved coach must have exactly one access profile.")
      }
    }
    if (["schedules", "loaded"].includes(stage)) {
      if (summary.series !== schedules.length || summary.recurrenceRules !== 48) {
        problems.push("Schedule stage must contain eight weekday and four weekend series.")
      }
      const dateCounts = db.prepare(`
        select occurrence_date as dateKey, count(*) as count
        from session_occurrences where status = 'scheduled'
        group by occurrence_date order by occurrence_date
      `).all() as Array<{ count: number; dateKey: string }>
      const actualDateCounts = new Map(dateCounts.map((row) => [row.dateKey, row.count]))
      const lifecycleDeltas = new Map((db.prepare(`
        select occurrence_date as dateKey,
          sum(case when status = 'cancelled' then 1 else 0 end) as cancelled,
          sum(case when replacement_for_occurrence_id is not null then 1 else 0 end) as replacements
        from session_occurrences
        group by occurrence_date
      `).all() as Array<{ cancelled: number; dateKey: string; replacements: number }>)
        .map((row) => [row.dateKey, row]))
      const cursor = new Date(`${SCHEDULE_START}T00:00:00.000Z`)
      const finalDate = new Date(`${SCHEDULE_END}T00:00:00.000Z`)
      let expectedDateGroups = 0
      while (cursor <= finalDate) {
        expectedDateGroups += 1
        const dateKey = cursor.toISOString().slice(0, 10)
        const weekday = cursor.getUTCDay()
        const baseExpected = weekday === 0 || weekday === 6 ? 4 : 8
        const delta = lifecycleDeltas.get(dateKey)
        const expected = baseExpected - (delta?.cancelled ?? 0) + (delta?.replacements ?? 0)
        const actual = actualDateCounts.get(dateKey) ?? 0
        if (actual !== expected) problems.push(`${dateKey} has ${actual} sessions instead of ${expected}.`)
        cursor.setUTCDate(cursor.getUTCDate() + 1)
      }
      if (actualDateCounts.size !== expectedDateGroups) {
        problems.push(`Schedule window contains ${actualDateCounts.size} dated occurrence groups instead of ${expectedDateGroups}.`)
      }
      if (stage === "loaded") {
        const lifecycle = db.prepare(`
          select
            sum(case when status = 'cancelled' then 1 else 0 end) as cancelled,
            sum(case when replacement_for_occurrence_id is not null then 1 else 0 end) as replacements
          from session_occurrences
        `).get() as { cancelled: number; replacements: number }
        if (lifecycle.cancelled !== 2 || lifecycle.replacements !== 1) {
          problems.push(`${selectedProfile.key} requires one cancellation and one replacement lifecycle example.`)
        }
      }
    }
    if (stage === "loaded") {
      if (summary.assignments !== expectedAssignments) {
        problems.push(`Loaded ${selectedProfile.key} profile must contain ${expectedAssignments} assignments.`)
      }
      const activeAssignmentCount = db.prepare(`
        select count(*) as count from session_assignments where effective_to is null
      `).get() as { count: number }
      if (activeAssignmentCount.count !== expectedActiveAssignments) {
        problems.push(
          `Loaded ${selectedProfile.key} profile must contain ${expectedActiveAssignments} active assignments.`,
        )
      }
      const lifecycle = db.prepare(`
        select
          sum(case when e.status = 'active' and a.archived_at is null then 1 else 0 end) as active,
          sum(case when e.status = 'paused' and a.archived_at is null then 1 else 0 end) as paused,
          sum(case when e.status = 'unassigned' and a.archived_at is null then 1 else 0 end) as unassigned,
          sum(case when a.archived_at is not null then 1 else 0 end) as archived
        from player_enrollments e join accounts a on a.id = e.account_id
      `).get() as { active: number; archived: number; paused: number; unassigned: number }
      if (lifecycle.active !== players.length - 6
        || lifecycle.paused !== 3
        || lifecycle.unassigned !== 2
        || lifecycle.archived !== 1) {
        problems.push(
          `${selectedProfile.key} requires active, paused, unassigned and archived player representatives.`,
        )
      }
      const activeCohorts = db.prepare(`
        select count(*) as count from (
          select e.level, e.batch
          from player_enrollments e join accounts a on a.id = e.account_id
          where e.status = 'active' and a.archived_at is null
          group by e.level, e.batch
        )
      `).get() as { count: number }
      if (activeCohorts.count !== 8) {
        problems.push("Every Level and Batch cohort must retain an active representative.")
      }
      if (summary.reports !== expectedReports || summary.publications !== expectedPublications) {
        problems.push(
          `Report mix must contain ${expectedReports} records and ${expectedPublications} publications.`,
        )
      }
      if (selectedProfile.key === "demo") {
        const representativeMonths = db.prepare(`
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
        const expectedMonths = [
          REPORT_MONTH,
          ...representativeReportHistory.map((report) => report.month),
        ].sort((first, second) => second.localeCompare(first))
        if (JSON.stringify(representativeMonths) !== JSON.stringify(expectedMonths)) {
          problems.push("Demo representative player must retain five published report months.")
        }
      }
      const multiRevisionReports = db.prepare(`
        select count(*) as count
        from (
          select report_id
          from report_publications
          group by report_id
          having count(*) >= 2 and max(revision) >= 2
        )
      `).get() as { count: number }
      if (multiRevisionReports.count < 1) {
        problems.push("Report coverage must contain one immutable multi-revision publication history.")
      }
      const mismatches = db.prepare(`
        select count(*) as count
        from session_assignments a
        join player_enrollments e on e.account_id = a.account_id
        join session_series s on s.id = a.series_id
        where e.level <> s.programme or e.batch <> s.batch
      `).get() as { count: number }
      if (mismatches.count) problems.push("Assignments must match player level and batch.")
      const weekdayCoverage = db.prepare(`
        select m.identifier as academyId, e.academy_plan as academyPlan,
          count(distinct w.weekday) as assignedDays
        from player_enrollments e
        join auth_methods m on m.account_id = e.account_id and m.revoked_at is null
        join session_assignments a on a.account_id = e.account_id and a.effective_to is null
        join session_assignment_weekdays w on w.assignment_id = a.id
        where e.batch = 'Weekday'
        group by e.account_id, e.academy_plan
      `).all() as Array<{ academyId: string; academyPlan: AcademyPlan; assignedDays: number }>
      const expectedDays: Partial<Record<AcademyPlan, number>> = {
        "weekday-3-day": 3,
        "weekday-4-day": 4,
        "weekday-5-day": 5,
      }
      weekdayCoverage.forEach((row) => {
        if (row.assignedDays !== expectedDays[row.academyPlan]) {
          problems.push(`${row.academyId} has ${row.assignedDays} distinct weekdays for ${row.academyPlan}.`)
        }
      })
      const expectedWeekdayAssignments = players.filter((player) => (
        player.batch === "Weekday" && player.finalState === "active"
      )).length
      if (weekdayCoverage.length !== expectedWeekdayAssignments) {
        problems.push(
          `Loaded stage contains ${weekdayCoverage.length} Weekday assignments instead of ${expectedWeekdayAssignments}.`,
        )
      }
      if (summary.feeAgreements < financePlayerCount + 1) {
        problems.push("The finance fixture must retain one ended-and-restarted Fee Plan example.")
      }
      const baseChargeCoverage = db.prepare(`
        select
          count(distinct case when type = 'registration' then player_account_id end) as registrationPlayers,
          count(distinct case when type = 'monthly_training' and billing_period = '2026-07' then player_account_id end) as julyPlayers,
          count(distinct case when type = 'monthly_training' and billing_period = '2026-08' then player_account_id end) as augustPlayers
        from financial_charges
      `).get() as {
        registrationPlayers: number
        julyPlayers: number
        augustPlayers: number
      }
      if (baseChargeCoverage.registrationPlayers !== financePlayerCount
        || baseChargeCoverage.julyPlayers !== julyFinancePlayerCount
        || baseChargeCoverage.augustPlayers !== augustFinancePlayerCount) {
        problems.push("Finance fixture Charge coverage does not match Fee Plans and assigned players.")
      }
      const expectedAugustPayments = selectedProfile.key === "stress" ? 70
        : selectedProfile.key === "demo" ? 27 : 17
      const fixturePayments = db.prepare(`
        select
          count(distinct p.id) as payments,
          count(a.id) as allocations
        from payments p
        left join payment_allocations a on a.payment_id = p.id
        where p.idempotency_key like ?
      `).get(`fixture.${selectedProfile.key}.finance.payment.2026-08.%`) as {
        allocations: number
        payments: number
      }
      if (fixturePayments.payments !== expectedAugustPayments
        || fixturePayments.allocations !== expectedAugustPayments) {
        problems.push(`Finance fixture must contain ${expectedAugustPayments} August receipts.`)
      }
      if (summary.refunds < 2 || summary.refundAllocations < 2) {
        problems.push("The Phase 3 fixture must contain two Refunds and their allocations.")
      }
      if (summary.concessions < 2 || summary.concessionApplications < 2) {
        problems.push("The Phase 3 fixture must contain two Concessions and their applications.")
      }
      if (summary.financeReferenceSequences < 2) {
        problems.push("The fixture must contain independent receipt and Refund sequences.")
      }
      const legacySettlements = db.prepare(`
        select count(*) as count from charge_adjustments where kind = 'legacy_settlement'
      `).get() as { count: number }
      if (legacySettlements.count !== 0) {
        problems.push("Fresh fixture profiles must never contain legacy settlements.")
      }
      if (summary.chargeAdjustments < 2) {
        problems.push("Finance fixture must contain active and reversed Concession adjustments.")
      }
      const activationCount = db.prepare(`
        select count(*) as count from financial_audit_events
        where event_type = 'finance_activated' and entity_type = 'academy'
      `).get() as { count: number }
      if (activationCount.count !== 1) problems.push("Finance must have one irreversible activation event.")
      const financeLifecycle = db.prepare(`
        select
          (select count(*) from refunds where lifecycle = 'recorded') as recordedRefunds,
          (select count(*) from refunds where lifecycle = 'reversed') as reversedRefunds,
          (select count(*) from concessions where lifecycle = 'active') as activeConcessions,
          (select count(*) from concessions where lifecycle = 'reversed') as reversedConcessions,
          (select count(*) from concession_applications where reversed_at is null) as activeApplications,
          (select count(*) from concession_applications where reversed_at is not null) as reversedApplications,
          (select count(*) from fee_agreements where status = 'active') as activeAgreements,
          (select count(*) from fee_agreements where status = 'ended') as endedAgreements,
          (select count(distinct player_account_id) from refunds
            where purpose = 'mid_term_withdrawal') as withdrawalPlayers,
          (select count(*) from refunds
            where purpose = 'mid_term_withdrawal'
              and withdrawal_effective_on is not null
              and charge_adjustment_id is not null) as linkedWithdrawalRefunds,
          (select count(*) from charge_adjustments
            where kind = 'withdrawal_credit') as withdrawalCredits
      `).get() as {
        activeAgreements: number
        activeApplications: number
        activeConcessions: number
        endedAgreements: number
        recordedRefunds: number
        reversedApplications: number
        reversedConcessions: number
        reversedRefunds: number
        linkedWithdrawalRefunds: number
        withdrawalCredits: number
        withdrawalPlayers: number
      }
      if (financeLifecycle.recordedRefunds < 1 || financeLifecycle.reversedRefunds < 1) {
        problems.push("Refund coverage must contain one recorded and one reversed Refund.")
      }
      if (financeLifecycle.activeConcessions < 1
        || financeLifecycle.reversedConcessions < 1
        || financeLifecycle.activeApplications < 1
        || financeLifecycle.reversedApplications < 1) {
        problems.push("Concession coverage must contain active and reversed lifecycle examples.")
      }
      if (financeLifecycle.linkedWithdrawalRefunds !== 2
        || financeLifecycle.withdrawalCredits !== 2) {
        problems.push("Withdrawal Refunds must retain their dates and linked unused-training credits.")
      }
      if (financeLifecycle.activeAgreements
          !== financePlayerCount - financeLifecycle.withdrawalPlayers
        || financeLifecycle.endedAgreements < financeLifecycle.withdrawalPlayers + 1) {
        problems.push("Fee Plan coverage must reflect withdrawal closures plus restarted-plan history.")
      }
      const expectedPaid = selectedProfile.key === "stress" ? 55
        : selectedProfile.key === "demo" ? 20 : 12
      const expectedPartial = selectedProfile.key === "stress" ? 15
        : selectedProfile.key === "demo" ? 7 : 5
      const expectedUnpaid = augustFinancePlayerCount - expectedPaid - expectedPartial
      const augustStatus = db.prepare(`
        select
          sum(case when paid >= original_amount_paise then 1 else 0 end) as paid,
          sum(case when paid > 0 and paid < original_amount_paise then 1 else 0 end) as partial,
          sum(case when paid = 0 then 1 else 0 end) as unpaid
        from (
          select c.original_amount_paise,
            coalesce(sum(case
              when p.lifecycle = 'recorded'
              then a.amount_paise else 0 end), 0) as paid
          from financial_charges c
          left join payment_allocations a on a.charge_id = c.id
          left join payments p on p.id = a.payment_id
          where c.type = 'monthly_training' and c.billing_period = '2026-08'
            and c.lifecycle = 'issued'
          group by c.id
        )
      `).get() as {
        paid: number
        partial: number
        unpaid: number
      }
      if (augustStatus.paid !== expectedPaid
        || augustStatus.partial !== expectedPartial
        || augustStatus.unpaid !== expectedUnpaid) {
        problems.push(
          `August mix must contain ${expectedPaid} paid, ${expectedPartial} partial and ${expectedUnpaid} unpaid players.`,
        )
      }
      const expectedStaffAttendance = selectedProfile.key === "demo" ? 40 : 41
      if (summary.attendanceAdjustments !== 2) {
        problems.push(`${selectedProfile.key} requires one active and one voided attendance adjustment.`)
      }
      if (summary.staffAttendance !== expectedStaffAttendance) {
        problems.push(`${selectedProfile.key} requires ${expectedStaffAttendance} staff attendance facts.`)
      }
      if (selectedProfile.key !== "demo") {
        const staffChoiceCoverage = db.prepare(`
          select
            sum(case when choice = 'present' then 1 else 0 end) as present,
            sum(case when choice = 'absent' then 1 else 0 end) as absent,
            sum(case when choice = 'cleared' then 1 else 0 end) as cleared
          from staff_attendance_records
        `).get() as { absent: number; cleared: number; present: number }
        if (!staffChoiceCoverage.present
          || !staffChoiceCoverage.absent
          || staffChoiceCoverage.cleared !== 1) {
          problems.push(`${selectedProfile.key} requires present, absent and cleared staff attendance.`)
        }

          const crossWeekdayReplacement = db.prepare(`
            with recursive lineage(
              replacement_id,
              current_id,
              series_id,
              root_date,
              parent_id,
              depth
            ) as (
              select id, id, series_id, occurrence_date,
                replacement_for_occurrence_id, 0
              from session_occurrences
              where status = 'scheduled'
                and replacement_for_occurrence_id is not null
              union all
              select lineage.replacement_id, parent.id, parent.series_id,
                parent.occurrence_date, parent.replacement_for_occurrence_id,
                lineage.depth + 1
              from lineage
              join session_occurrences parent on parent.id = lineage.parent_id
              where lineage.depth < 32
            )
            select replacement.occurrence_date as actualDate,
              root.root_date as sourceDate,
              cast(strftime('%w', replacement.occurrence_date) as integer) as actualWeekday,
              cast(strftime('%w', root.root_date) as integer) as sourceWeekday,
              (
                select count(distinct assignment.account_id)
                from session_assignments assignment
                join session_assignment_weekdays weekday
                  on weekday.assignment_id = assignment.id
                where assignment.series_id = replacement.series_id
                  and root.root_date >= assignment.effective_from
                  and (
                    assignment.effective_to is null
                    or root.root_date < assignment.effective_to
                  )
                  and weekday.weekday = cast(strftime('%w', root.root_date) as integer)
              ) as sourceRoster,
              (
                select count(distinct assignment.account_id)
                from session_assignments assignment
                join session_assignment_weekdays weekday
                  on weekday.assignment_id = assignment.id
                where assignment.series_id = replacement.series_id
                  and replacement.occurrence_date >= assignment.effective_from
                  and (
                    assignment.effective_to is null
                    or replacement.occurrence_date < assignment.effective_to
                  )
                  and weekday.weekday = cast(
                    strftime('%w', replacement.occurrence_date) as integer
                  )
              ) as targetRoster
            from session_occurrences replacement
            join lineage root
              on root.replacement_id = replacement.id
              and root.parent_id is null
            where replacement.status = 'scheduled'
              and replacement.replacement_for_occurrence_id is not null
            limit 1
          `).get() as {
            actualDate: string
            actualWeekday: number
            sourceDate: string
            sourceRoster: number
            sourceWeekday: number
            targetRoster: number
          } | undefined
          if (!crossWeekdayReplacement
            || ![0, 6].includes(crossWeekdayReplacement.sourceWeekday)
            || ![1, 2, 3, 4, 5].includes(crossWeekdayReplacement.actualWeekday)
            || crossWeekdayReplacement.actualDate === crossWeekdayReplacement.sourceDate
            || crossWeekdayReplacement.sourceRoster < 1
            || crossWeekdayReplacement.targetRoster !== 0) {
            problems.push(
              `${selectedProfile.key} requires one cross-weekday replacement whose root-date roster remains eligible.`,
            )
          }

          const correctionFinance = db.prepare(`
            select
              (select count(*) from payments where lifecycle = 'reversed') as reversedPayments,
              (select count(*) from payments where idempotency_key = ?) as replacementPayments,
              (select count(*) from charge_adjustments where kind = 'manual_credit') as manualCredits,
              (select count(*) from charge_adjustments where kind = 'manual_debit') as manualDebits
          `).get(`fixture.${selectedProfile.key}.finance.payment-replacement`) as {
            manualCredits: number
            manualDebits: number
            replacementPayments: number
            reversedPayments: number
          }
          if (correctionFinance.reversedPayments !== 1
            || correctionFinance.replacementPayments !== 1
            || correctionFinance.manualCredits !== 1
            || correctionFinance.manualDebits !== 1) {
            problems.push(
              `${selectedProfile.key} requires one Payment replacement plus manual credit and debit corrections.`,
            )
          }
      }

      if (selectedProfile.key === "stress") {
        if (summary.announcements !== 5
          || summary.announcementChannels !== 7
          || summary.announcementWithdrawals !== 1) {
          problems.push("Stress requires five deterministic announcement lifecycle examples.")
        }
        const announcementCoverage = db.prepare(`
          select
            sum(case
              when w.broadcast_id is null
                and (b.expires_on is null or b.expires_on >= ?)
              then 1 else 0 end) as active,
            sum(case
              when w.broadcast_id is null and b.expires_on < ?
              then 1 else 0 end) as expired,
            sum(case when w.broadcast_id is not null then 1 else 0 end) as withdrawn,
            sum(case
              when w.broadcast_id is null
                and (b.expires_on is null or b.expires_on >= ?)
                and b.pinned = 1
              then 1 else 0 end) as pinnedActive,
            sum(case when b.presentation_revision > 0 then 1 else 0 end) as presentationChanged
          from broadcasts b
          left join broadcast_withdrawals w on w.broadcast_id = b.id
        `).get(CANONICAL_DATE, CANONICAL_DATE, CANONICAL_DATE) as {
          active: number
          expired: number
          pinnedActive: number
          presentationChanged: number
          withdrawn: number
        }
        if (announcementCoverage.active !== 3
          || announcementCoverage.expired !== 1
          || announcementCoverage.withdrawn !== 1
          || announcementCoverage.pinnedActive !== 1
          || announcementCoverage.presentationChanged !== 1) {
          problems.push("Stress announcement coverage must include active, pinned, expired and withdrawn states.")
        }
        const channelCoverage = db.prepare(`
          select
            sum(case when channelCount = 1 and homepage = 1 then 1 else 0 end) as homepageOnly,
            sum(case when channelCount = 1 and dashboard = 1 then 1 else 0 end) as dashboardOnly,
            sum(case when channelCount = 2 and homepage = 1 and dashboard = 1 then 1 else 0 end) as both
          from (
            select b.id, count(c.channel) as channelCount,
              max(case when c.channel = 'homepage' then 1 else 0 end) as homepage,
              max(case when c.channel = 'player_dashboard' then 1 else 0 end) as dashboard
            from broadcasts b
            join broadcast_channels c on c.broadcast_id = b.id
            group by b.id
          )
        `).get() as { both: number; dashboardOnly: number; homepageOnly: number }
        if (channelCoverage.homepageOnly !== 1
          || channelCoverage.dashboardOnly !== 2
          || channelCoverage.both !== 2) {
          problems.push("Stress announcements must cover Homepage-only, Dashboard-only and both-channel delivery.")
        }
      }
    }
    if (problems.length) throw new Error(problems.join("\n"))
    return {
      anchorDate: CANONICAL_DATE,
      checksum: logicalChecksum(db),
      database: target,
      integrity,
      profile: target === CLEAN_TARGET ? "clean" : selectedProfile.key,
      schema,
      stage,
      summary,
    }
  } finally {
    db.close()
  }
}

function fixtureManifest(target: string, profile: FixtureProfile) {
  const verification = verify(target, "loaded")
  const db = openReadonly(target)
  try {
    const coachRows = db.prepare(`
      select m.identifier as academyId, a.full_name as fullName,
        coalesce(p.access_level, 'head_admin') as accessLevel
      from accounts a
      join auth_methods m on m.account_id = a.id and m.revoked_at is null
      left join coach_profiles p on p.account_id = a.id
      where a.role = 'coach' and a.approval_status = 'approved'
      order by m.identifier
    `).all() as Array<{ accessLevel: string; academyId: string; fullName: string }>
    const playerRows = db.prepare(`
      select m.identifier as academyId, a.full_name as fullName
      from player_enrollments e
      join accounts a on a.id = e.account_id
      join auth_methods m on m.account_id = a.id and m.revoked_at is null
      order by m.identifier
    `).all() as Array<{ academyId: string; fullName: string }>
    const longName = playerRows.find((player) => player.fullName.length > 30) ?? playerRows[0]
    return {
      version: 2,
      profile: profile.key,
      description: profile.description,
      anchorDate: CANONICAL_DATE,
      database: path.relative(process.cwd(), profile.target),
      checksum: verification.checksum,
      integrity: verification.integrity,
      schema: verification.schema,
      expectedCounts: verification.summary,
      logins: {
        headCoach: coachRows.find((coach) => coach.accessLevel === "head_admin") ?? coachRows[0],
        juniorCoaches: coachRows.filter((coach) => coach.accessLevel === "junior_coach"),
        representativePlayer: playerRows[0],
        longNamePlayer: longName,
      },
      pendingRegistrations: [...profile.pendingPlayerNames],
    }
  } finally {
    db.close()
  }
}

function cleanFixtureManifest(target: string) {
  const verification = verify(target, "default")
  const db = openReadonly(target)
  try {
    const headCoach = db.prepare(`
      select m.identifier as academyId, a.full_name as fullName,
        coalesce(p.access_level, 'head_admin') as accessLevel
      from accounts a
      join auth_methods m on m.account_id = a.id and m.revoked_at is null
      left join coach_profiles p on p.account_id = a.id
      where a.role = 'coach' and a.approval_status = 'approved'
      order by m.identifier
      limit 1
    `).get()
    return {
      version: 2,
      profile: "clean",
      description: "Clean head-coach-only academy for empty-state development",
      anchorDate: CANONICAL_DATE,
      database: path.relative(process.cwd(), target),
      checksum: verification.checksum,
      integrity: verification.integrity,
      schema: verification.schema,
      expectedCounts: verification.summary,
      logins: { headCoach },
    }
  } finally {
    db.close()
  }
}

function writeFixtureManifest(target: string, profile: FixtureProfile) {
  if (target !== profile.target) return
  const manifest = fixtureManifest(target, profile)
  fs.writeFileSync(profileManifestPath(profile), `${JSON.stringify(manifest, null, 2)}\n`)
}

async function buildProfile(source: string, profile: FixtureProfile, target: string) {
  assertRegressionTarget(target)
  const targetDirectory = path.dirname(target)
  const buildDirectory = isAccessibilityTemporaryTarget(target)
    ? targetDirectory
    : REGRESSION_DIRECTORY
  const temporaryTarget = path.join(
    buildDirectory,
    isAccessibilityTemporaryTarget(target)
      ? `.smba-accessibility-${profile.key}-build-${process.pid}.db`
      : `.academy-${profile.key}-build-${process.pid}.db`,
  )
  const publishTarget = `${target}.next-${process.pid}`
  fs.mkdirSync(buildDirectory, { recursive: true })
  fs.mkdirSync(targetDirectory, { recursive: true })
  try {
    await prepare(source, temporaryTarget)
    await seedToStage(temporaryTarget, "loaded")
    const sourceDatabase = openReadonly(temporaryTarget)
    try {
      if (fs.existsSync(publishTarget)) fs.unlinkSync(publishTarget)
      await sourceDatabase.backup(publishTarget)
    } finally {
      sourceDatabase.close()
    }
    assertPublicationTargetQuiescent(target)
    fs.renameSync(publishTarget, target)
    writeFixtureManifest(target, profile)
    return verify(target, "loaded")
  } finally {
    for (const candidate of [
      temporaryTarget,
      `${temporaryTarget}-wal`,
      `${temporaryTarget}-shm`,
      publishTarget,
      `${publishTarget}-wal`,
      `${publishTarget}-shm`,
    ]) {
      if (fs.existsSync(candidate)) fs.unlinkSync(candidate)
    }
  }
}

async function buildCleanProfile(source: string, target: string) {
  assertRegressionTarget(target)
  const targetDirectory = path.dirname(target)
  const buildDirectory = isAccessibilityTemporaryTarget(target)
    ? targetDirectory
    : REGRESSION_DIRECTORY
  const temporaryTarget = path.join(
    buildDirectory,
    isAccessibilityTemporaryTarget(target)
      ? `.smba-accessibility-clean-build-${process.pid}.db`
      : `.academy-clean-build-${process.pid}.db`,
  )
  const publishTarget = `${target}.next-${process.pid}`
  fs.mkdirSync(buildDirectory, { recursive: true })
  fs.mkdirSync(targetDirectory, { recursive: true })
  try {
    await prepare(source, temporaryTarget)
    const sourceDatabase = openReadonly(temporaryTarget)
    try {
      if (fs.existsSync(publishTarget)) fs.unlinkSync(publishTarget)
      await sourceDatabase.backup(publishTarget)
    } finally {
      sourceDatabase.close()
    }
    assertPublicationTargetQuiescent(target)
    fs.renameSync(publishTarget, target)
    if (target === CLEAN_TARGET) {
      const manifest = cleanFixtureManifest(target)
      fs.writeFileSync(`${target}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`)
    }
    return verify(target, "default")
  } finally {
    for (const candidate of [
      temporaryTarget,
      `${temporaryTarget}-wal`,
      `${temporaryTarget}-shm`,
      publishTarget,
      `${publishTarget}-wal`,
      `${publishTarget}-shm`,
    ]) {
      if (fs.existsSync(candidate)) fs.unlinkSync(candidate)
    }
  }
}

async function main() {
  const args = parseArguments()
  let result
  if (args.command === "prepare-source") result = prepareGeneratedSource(args.source)
  else if (args.command === "build") {
    ensureGeneratedSource(args.source)
    result = await buildProfile(args.source, args.profile, args.target)
  }
  else if (args.command === "build-clean") {
    ensureGeneratedSource(args.source)
    result = await buildCleanProfile(args.source, args.target)
  }
  else if (args.command === "prepare") {
    ensureGeneratedSource(args.source)
    result = await prepare(args.source, args.target)
  }
  else if (args.command === "seed") {
    result = await seedToStage(args.target, args.stage)
    if (args.stage === "loaded") writeFixtureManifest(args.target, args.profile)
  }
  else if (args.command === "verify" || args.command === "summary") result = verify(args.target)
  else throw new Error(`Unknown regression fixture command: ${args.command}`)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exitCode = 1
})

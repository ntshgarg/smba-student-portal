import { sql } from "drizzle-orm"

import { PLATFORM_ADMIN_ACADEMY_ID } from "../../lib/auth/identity"
import { initializeDatabase } from "../../lib/db/client"

/**
 * Empties an academy in place, leaving one platform owner and nothing else.
 *
 * Written for handover: the owner keeps their account, credentials, PIN,
 * authenticator and recovery email, and every academy record around them is
 * removed so the incoming head coach starts from the one-time secure setup
 * rather than inheriting somebody else's roster.
 *
 * This deletes production data and nothing puts it back. It refuses to run
 * without `--confirm <ACADEMY_ID>` naming the owner it is about to keep, so the
 * command cannot be pasted at the wrong database and do something irreversible
 * before anybody reads it.
 */

/** Never touched: migration state, and the batch rows every academy needs. */
const PRESERVED = new Set([
  "__drizzle_migrations",
  "batches",
])

/**
 * Rows are kept only where the named column is the surviving owner. `accounts`
 * and `auth_users` key the owner by `id`; better-auth's own tables key it by
 * `user_id`, which holds the same value.
 */
const OWNER_SCOPED = new Map([
  ["accounts", "id"],
  ["auth_users", "id"],
  ["academy_id_allocations", "account_id"],
  ["auth_credential_states", "account_id"],
  ["auth_methods", "account_id"],
  ["auth_pin_credentials", "account_id"],
  ["auth_recovery_emails", "account_id"],
  ["auth_provider_accounts", "user_id"],
])

/**
 * Emptied completely. Sessions go too, so every device is signed out and the
 * owner's next sign-in is a fresh one; so do the finance sequences, so receipt
 * numbering restarts at the beginning rather than continuing somebody else's
 * run. The security and financial audit trails are academy history and go with
 * the academy -- take the backup first if that history matters.
 *
 * `auth_two_factors` goes as well, including the owner's. A handover should not
 * pass on an authenticator that is still paired to the outgoing operator's
 * phone: whoever holds the account next has to enrol their own, and the
 * recovery codes minted with it are the ones they keep. The password and PIN
 * survive, because those are what they sign in with to do it.
 */
const PURGED = new Set([
  "attendance_adjustments", "attendance_records", "auth_access_codes",
  "auth_activation_claims", "auth_authenticator_reset_requests", "auth_email_challenges",
  "auth_login_attempts", "auth_rate_limits", "auth_runtime_sessions", "auth_security_events",
  "auth_sessions", "auth_setup_claims", "auth_two_factors", "auth_verifications", "batch_memberships",
  "broadcast_audience_targets", "broadcast_channels", "broadcast_withdrawals", "broadcasts",
  "charge_adjustments", "client_error_reports", "coach_profiles", "concession_applications",
  "concessions", "fee_agreements", "finance_reference_sequences", "financial_audit_events",
  "financial_charges", "monthly_reports", "operational_events", "payment_allocations",
  "payments", "player_enrollments", "refund_allocations", "refunds", "report_publications",
  "session_assignment_weekdays", "session_assignments", "session_attendance_records",
  "session_occurrences", "session_recurrence_rules", "session_series", "staff_attendance_records",
])

/*
 * Purged, but allowed to refill immediately: the site stays live through a
 * reset, so a single visitor reaching the login page writes a login attempt and
 * a security event before anyone can check the result. Treating those as
 * survivors would fail a verification that is actually looking at ordinary
 * traffic. Nothing here describes an academy -- no member, session, charge or
 * report is in this list.
 */
const RUNTIME_NOISE = new Set([
  "auth_email_challenges",
  "auth_login_attempts",
  "auth_rate_limits",
  "auth_runtime_sessions",
  "auth_security_events",
  "auth_sessions",
  "auth_verifications",
  "client_error_reports",
  "operational_events",
])

const confirmIndex = process.argv.indexOf("--confirm")
const verifyOnly = process.argv.includes("--verify")
const confirmedAcademyId = confirmIndex < 0 ? null : process.argv[confirmIndex + 1]?.trim() ?? ""
const dryRun = confirmedAcademyId === null

const database = initializeDatabase()

function allTables(): string[] {
  const rows = database.all<{ name: string }>(sql`
    select name from sqlite_master
    where type = 'table' and name not like 'sqlite_%'
    order by name
  `)
  return rows.map((row) => row.name)
}

function countRows(table: string) {
  const row = database.get<{ total: number }>(
    sql.raw(`select count(*) as total from "${table}"`),
  )
  return row?.total ?? 0
}

/*
 * A table this script has never been told about is the failure it cannot see:
 * it would be left full while the report claims the academy is empty. A
 * migration that adds one must also decide which of the three lists it joins,
 * so an unknown table stops the run rather than being skipped quietly.
 */
function classify(tables: string[]) {
  const unknown = tables.filter((table) => (
    !PRESERVED.has(table) && !OWNER_SCOPED.has(table) && !PURGED.has(table)
  ))
  if (unknown.length) {
    throw new Error(
      `These tables are not classified by this script: ${unknown.join(", ")}. `
      + "Add each one to PRESERVED, OWNER_SCOPED or PURGED before resetting an academy.",
    )
  }
  const missing = [...PRESERVED, ...OWNER_SCOPED.keys(), ...PURGED]
    .filter((table) => !tables.includes(table))
  if (missing.length) {
    console.warn(`Listed but absent from this database: ${missing.join(", ")}`)
  }
}

/*
 * The platform owner does not draw a serial from `academy_id_allocations` the
 * way players and coaches do -- its Academy ID is the fixed
 * PLATFORM_ADMIN_ACADEMY_ID constant, written straight onto the sign-in
 * username. So the identity is confirmed against `auth_users`, and an owner
 * whose username has drifted from the constant stops the run rather than being
 * silently accepted as the account worth keeping.
 */
function soleOwner() {
  const owners = database.all<{ id: string; fullName: string; username: string | null }>(sql`
    select a.id as id, a.full_name as fullName, u.username as username
    from accounts a
    left join auth_users u on u.id = a.id
    where a.role = 'platform_admin'
      and a.approval_status = 'approved'
      and a.archived_at is null
  `)

  if (owners.length !== 1) {
    throw new Error(
      `Expected exactly one approved platform owner, found ${owners.length}. `
      + "Resolve that before resetting, so the account this keeps is unambiguous.",
    )
  }
  const owner = owners[0]
  if (owner.username !== PLATFORM_ADMIN_ACADEMY_ID) {
    throw new Error(
      `The platform owner signs in as ${owner.username ?? "(no username)"}, not `
      + `${PLATFORM_ADMIN_ACADEMY_ID}. Refusing to reset against an account this script cannot name.`,
    )
  }
  return { ...owner, academyId: owner.username }
}

/*
 * Answers "is this academy empty?" rather than "was anything deleted?", so it
 * can be run at any time, including long after a reset and against live
 * traffic. Owner-scoped tables are excluded because the owner is meant to
 * survive; runtime noise is excluded because it is meant to come back.
 */
function verify(tables: string[], owner: { academyId: string }) {
  const survivors = tables
    .filter((table) => PURGED.has(table) && !RUNTIME_NOISE.has(table))
    .map((table) => ({ count: countRows(table), table }))
    .filter((entry) => entry.count > 0)

  if (survivors.length) {
    console.error("Academy records are still present:")
    for (const { count, table } of survivors) {
      console.error(`  ${table.padEnd(38)} ${String(count).padStart(6)}`)
    }
    process.exitCode = 1
    return
  }

  const others = countRows("accounts") - 1
  if (others > 0) {
    console.error(`${others} account(s) besides ${owner.academyId} are still present.`)
    process.exitCode = 1
    return
  }

  console.log(`The academy is empty. Only ${owner.academyId} remains.`)
}

function main() {
  const tables = allTables()
  classify(tables)
  const owner = soleOwner()

  if (verifyOnly) {
    verify(tables, owner)
    return
  }

  const before = new Map(tables.map((table) => [table, countRows(table)]))
  const academyRows = tables
    .filter((table) => !PRESERVED.has(table))
    .reduce((total, table) => total + (before.get(table) ?? 0), 0)

  console.log(`Database holds ${academyRows} rows outside migrations and batches.`)
  console.log(`Platform owner to keep: ${owner.fullName} (${owner.academyId}).`)

  if (dryRun) {
    console.log("\nDry run. Nothing was changed.")
    console.log(`To empty this academy, re-run with:  --confirm ${owner.academyId}`)
    for (const table of tables) {
      const count = before.get(table) ?? 0
      if (!count) continue
      const fate = PRESERVED.has(table)
        ? "kept"
        : OWNER_SCOPED.has(table) ? "owner row kept" : "emptied"
      console.log(`  ${table.padEnd(38)} ${String(count).padStart(6)}  ->  ${fate}`)
    }
    return
  }

  if (confirmedAcademyId !== owner.academyId) {
    throw new Error(
      `--confirm was given "${confirmedAcademyId}" but this database's platform owner is `
      + `${owner.academyId}. Refusing to reset a database other than the one you named.`,
    )
  }

  /*
   * Foreign keys are enforced (lib/db/client.ts turns them on), and these
   * deletes cannot be ordered to satisfy every constraint at once -- accounts
   * reference accounts. Deferring moves the check to COMMIT, so the whole reset
   * is one all-or-nothing step that still refuses to leave a dangling row.
   */
  database.run(sql`begin`)
  try {
    database.run(sql`pragma defer_foreign_keys = on`)
    for (const table of PURGED) {
      if (!tables.includes(table)) continue
      database.run(sql.raw(`delete from "${table}"`))
    }
    for (const [table, column] of OWNER_SCOPED) {
      if (!tables.includes(table)) continue
      database.run(sql.raw(`delete from "${table}" where "${column}" <> '${owner.id}'`))
    }
    /*
     * Clearing the row is not enough on its own: better-auth reads this flag to
     * decide whether an account has an authenticator, and an account still
     * claiming one it no longer has cannot sign in at all.
     */
    database.run(sql.raw(
      `update auth_users set two_factor_enabled = 0 where id = '${owner.id}'`,
    ))
    database.run(sql`commit`)
  } catch (error) {
    database.run(sql`rollback`)
    throw error
  }

  console.log("\nAcademy emptied. Remaining rows:")
  let remaining = 0
  for (const table of tables) {
    const count = countRows(table)
    if (!count) continue
    remaining += PRESERVED.has(table) ? 0 : count
    console.log(`  ${table.padEnd(38)} ${String(count).padStart(6)}`)
  }
  console.log(`\n${remaining} rows remain outside migrations and batches; all belong to ${owner.academyId}.`)
  console.log(`${owner.academyId} keeps its password and PIN, and must enrol a new authenticator on next sign-in.`)
  console.log("The head coach is then created through the one-time secure setup.")
}

main()

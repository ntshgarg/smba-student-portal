import fs from "node:fs"
import path from "node:path"

import BetterSqlite3 from "better-sqlite3"
import { eq } from "drizzle-orm"

import {
  assertDisposableFinanceFixturePaths,
  verifyFinanceFixtureDatabase,
} from "./finance-fixture-support"

async function main() {
const [sourceArgument, targetArgument] = process.argv.slice(2)
if (!sourceArgument || !targetArgument) {
  throw new Error("Usage: prepare-finance-fixture <clean-source.db> </tmp/finance-target.db>")
}

const { source, target } = assertDisposableFinanceFixturePaths(sourceArgument, targetArgument)
verifyFinanceFixtureDatabase(source)
fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })

const sourceDatabase = new BetterSqlite3(source, { fileMustExist: true, readonly: true })
try {
  await sourceDatabase.backup(target)
} finally {
  sourceDatabase.close()
}
fs.chmodSync(target, 0o600)
verifyFinanceFixtureDatabase(target)

process.env.DB_FILE_NAME = target
process.env.SMBA_USE_TURSO = "false"
process.env.TURSO_DATABASE_URL = ""
process.env.TURSO_AUTH_TOKEN = ""
process.env.VERCEL = ""
process.env.VERCEL_ENV = ""

const [
  accountService,
  credentialService,
  databaseClient,
  schema,
  memberService,
  sessionService,
  financeService,
  format,
] = await Promise.all([
  import("../../lib/auth/account-service"),
  import("../../lib/auth/credential-service"),
  import("../../lib/db/client"),
  import("../../lib/db/schema"),
  import("../../lib/coach/member-service"),
  import("../../lib/sessions/service"),
  import("../../lib/finance/service"),
  import("../../lib/format"),
])

const database = databaseClient.initializeDatabase()
const now = new Date()
const today = format.getAcademyDateKey(now)
const trackingMonth = today.slice(0, 7)
const firstFeeDate = new Date(`${trackingMonth}-01T00:00:00.000Z`)
firstFeeDate.setUTCMonth(firstFeeDate.getUTCMonth() + 1)
const firstFeeMonth = firstFeeDate.toISOString().slice(0, 7)
const followingMonth = new Date(`${firstFeeMonth}-01T00:00:00.000Z`)
followingMonth.setUTCMonth(followingMonth.getUTCMonth() + 1)
followingMonth.setUTCDate(0)
const scheduleEndsOn = followingMonth.toISOString().slice(0, 10)
const coach = database.select({ id: schema.accounts.id })
  .from(schema.accounts)
  .innerJoin(schema.coachProfiles, eq(
    schema.coachProfiles.accountId,
    schema.accounts.id,
  ))
  .where(eq(schema.coachProfiles.accessLevel, "head_admin"))
  .get()
if (!coach) throw new Error("The clean fixture does not contain its head coach.")

financeService.activateFinance({
  idempotencyKey: "finance-e2e-activate",
  trackingMonth,
}, { coachId: coach.id, database, now })

const fullName = "Finance Regression Player"
const playerId = accountService.registerAccount(fullName, "player")
const approved = accountService.approveRegistration(playerId, coach.id, {
  chooseAcademyIdIndex: () => 0,
  now,
  requestedRole: "player",
})
credentialService.provisionDevelopmentCredential({
  academyId: approved.academyId,
  accountId: playerId,
  fullName,
  password: process.env.SMBA_FIXTURE_PASSWORD ?? credentialService.FIXTURE_PASSWORD,
}, { database, now })

const member = memberService.readCanonicalPlayerRecord(database, playerId)
if (!member) throw new Error("The approved finance regression player could not be loaded.")
const updated = memberService.updateMemberRecord({
  coachId: coach.id,
  database,
  input: {
    expectedRevision: member.training.recordRevision,
    memberId: playerId,
    profile: {
      fullName,
      joinedAt: today,
      primaryContact: {
        name: "Regression Guardian",
        phone: "+91 99999 00000",
        relationship: "Guardian",
      },
    },
    training: {
      academyPlan: "weekday-3-day",
      batch: "Weekday",
      level: "Beginner",
    },
  },
  now,
})
if (!updated.ok) throw new Error(`Finance regression assessment failed: ${updated.message}`)

const weekdays = [1, 3, 5]
const seriesId = sessionService.createSessionSeriesRecords({
  coachId: coach.id,
  database,
  input: {
    batch: "Weekday",
    durationMinutes: 60,
    endsOn: scheduleEndsOn,
    programme: "Beginner",
    startsOn: today,
    startTime: "06:00",
    venue: "SMBA Regression Court",
    weekdays,
  },
  now,
})
sessionService.assignSessionRecords({
  coachId: coach.id,
  database,
  effectiveFrom: today,
  now,
  playerId,
  seriesId,
  weekdays,
})

databaseClient.closeDatabaseConnection()
const verification = verifyFinanceFixtureDatabase(target)
process.stdout.write(`${JSON.stringify({
  academyId: approved.academyId,
  database: target,
  firstFeeMonth,
  playerId,
  today,
  verification,
})}\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Finance fixture preparation failed."}\n`)
  process.exitCode = 1
})

import { existsSync } from "node:fs"

import Database from "better-sqlite3"

export default function registrationResilienceGlobalSetup() {
  const databasePath = process.env.SMBA_REGISTRATION_RESILIENCE_DB
  if (!databasePath || !existsSync(databasePath)) {
    throw new Error(
      "SMBA_REGISTRATION_RESILIENCE_DB must identify an existing disposable Clean clone.",
    )
  }

  const database = new Database(databasePath, { fileMustExist: true, readonly: true })
  try {
    database.pragma("query_only = ON")
    const summary = database.prepare(`
      SELECT
        count(*) AS accountCount,
        sum(CASE WHEN a.approval_status = 'approved'
          AND a.role = 'coach'
          AND m.identifier = 'SMBA-HC-0001' THEN 1 ELSE 0 END) AS headCoachCount
      FROM accounts a
      LEFT JOIN auth_methods m
        ON m.account_id = a.id
        AND m.method = 'academy_id'
        AND m.revoked_at IS NULL
    `).get() as { accountCount: number; headCoachCount: number }

    if (summary.accountCount !== 1 || summary.headCoachCount !== 1) {
      throw new Error(
        "Registration resilience tests require a fresh Clean clone containing only the approved head coach.",
      )
    }
    if (database.pragma("integrity_check", { simple: true }) !== "ok") {
      throw new Error("The disposable Clean clone failed SQLite integrity_check.")
    }
    if ((database.pragma("foreign_key_check") as unknown[]).length !== 0) {
      throw new Error("The disposable Clean clone failed SQLite foreign_key_check.")
    }
  } finally {
    database.close()
  }
}

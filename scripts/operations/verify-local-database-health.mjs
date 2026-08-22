import path from "node:path"

import BetterSqlite3 from "better-sqlite3"

const [databaseArgument] = process.argv.slice(2)
if (!databaseArgument) throw new Error("Provide the local database path to verify.")
const databasePath = path.resolve(databaseArgument)
const database = new BetterSqlite3(databasePath, { fileMustExist: true, readonly: true })
try {
  const integrity = database.pragma("integrity_check", { simple: true })
  if (integrity !== "ok") throw new Error("Restored database integrity verification failed.")
  if (database.pragma("foreign_key_check").length > 0) {
    throw new Error("Restored database foreign-key verification failed.")
  }
  process.stdout.write("Restored database integrity and foreign keys passed.\n")
} finally {
  database.close()
}

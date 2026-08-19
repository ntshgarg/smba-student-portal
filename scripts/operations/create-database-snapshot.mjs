import { createDatabaseSnapshot } from "./database-snapshot.mjs"

const outputPath = process.argv[2]
const source = process.env.SMBA_DATABASE_SNAPSHOT_SOURCE?.trim()
  ?? process.env.TURSO_DATABASE_URL?.trim()
const authToken = process.env.SMBA_DATABASE_SNAPSHOT_TOKEN?.trim()
  ?? process.env.TURSO_AUTH_TOKEN?.trim()

if (!outputPath) {
  throw new Error("Provide a new output path, for example .data/backups/smba-2026-08-20.db.")
}
if (!source) {
  throw new Error("SMBA_DATABASE_SNAPSHOT_SOURCE or TURSO_DATABASE_URL is required.")
}

const result = createDatabaseSnapshot({ authToken, outputPath, source })
console.log(JSON.stringify(result))

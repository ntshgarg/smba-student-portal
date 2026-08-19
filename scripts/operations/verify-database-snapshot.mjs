import { verifyDatabaseSnapshot } from "./database-snapshot.mjs"

const snapshotPath = process.argv[2]
const manifestPath = process.argv[3]

if (!snapshotPath) {
  throw new Error("Provide the SQLite snapshot path to verify.")
}

console.log(JSON.stringify(verifyDatabaseSnapshot({ manifestPath, snapshotPath })))

import { prepareDatabase, remoteDatabasePreparationBlocked } from "../../lib/db/setup"

const seed = process.argv.includes("--seed")
const emptyAcademy = process.argv.includes("--empty-academy")

if (remoteDatabasePreparationBlocked()) {
  console.warn([
    `Skipped database preparation: this ${process.env.VERCEL_ENV ?? "non-production"} deployment`,
    "must not migrate or seed the remote database named by TURSO_DATABASE_URL.",
    "Scope TURSO_DATABASE_URL and TURSO_AUTH_TOKEN to Production, give this environment its own",
    "database, then set SMBA_ALLOW_REMOTE_DB_MIGRATION=true there to prepare that database.",
  ].join(" "))
  process.exit(0)
}

prepareDatabase({ emptyAcademy, seed })

console.log(seed
  ? emptyAcademy
    ? "Applied database migrations and prepared a zero-member academy for separate owner provisioning."
    : "Applied database migrations and ensured the baseline academy records."
  : "Applied database migrations.")

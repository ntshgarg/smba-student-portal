import { prepareDatabase } from "../../lib/db/setup"

const seed = process.argv.includes("--seed")

prepareDatabase({ seed })

console.log(seed
  ? "Applied database migrations and ensured the baseline academy records."
  : "Applied database migrations.")

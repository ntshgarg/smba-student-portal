import { prepareDatabase } from "../../lib/db/setup"

const seed = process.argv.includes("--seed")
const emptyAcademy = process.argv.includes("--empty-academy")

prepareDatabase({ emptyAcademy, seed })

console.log(seed
  ? emptyAcademy
    ? "Applied database migrations and prepared a zero-member academy for separate owner provisioning."
    : "Applied database migrations and ensured the baseline academy records."
  : "Applied database migrations.")

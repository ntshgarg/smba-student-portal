import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import { sanitizeFailureText } from "../../tests/e2e/support/failure-evidence"

const [input, output] = process.argv.slice(2)
if (!input || !output || !output.endsWith(".sanitized.txt")) {
  throw new Error("Usage: sanitize-server-log <input> <output.sanitized.txt>")
}

const lines = existsSync(input) ? readFileSync(input, "utf8").split("\n").slice(-200) : []
const sanitized = `${sanitizeFailureText(lines.join("\n"))}\n`
mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 })
writeFileSync(output, sanitized, { mode: 0o600 })
process.stdout.write(sanitized)

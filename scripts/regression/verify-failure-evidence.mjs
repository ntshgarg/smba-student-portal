import { readdir, readFile, rm, stat } from "node:fs/promises"
import path from "node:path"

const root = path.resolve(process.argv[2] ?? "output/failure-evidence")
const forbiddenValues = [
  process.env.SMBA_FAILURE_EVIDENCE_SENTINEL_SECRET,
  process.env.SMBA_FAILURE_EVIDENCE_SENTINEL_EMAIL,
].filter(Boolean)

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await filesBelow(candidate))
    else if (entry.isFile()) files.push(candidate)
  }
  return files
}

const files = await filesBelow(root)
const relativeFiles = files.map((file) => path.relative(root, file))
const rejected = relativeFiles.filter((file) => !/\.(?:masked\.png|sanitized\.(?:json|txt))$/u.test(file))
if (rejected.length) throw new Error(`Failure evidence contained non-allowlisted files: ${rejected.join(", ")}`)
if (!relativeFiles.some((file) => file.endsWith(".masked.png"))) {
  throw new Error("Failure evidence did not contain a masked screenshot.")
}
if (!relativeFiles.some((file) => file.endsWith(".sanitized.json"))) {
  throw new Error("Failure evidence did not contain sanitized metadata.")
}

for (const file of files) {
  if (file.endsWith(".png")) {
    if ((await stat(file)).size === 0) throw new Error(`${file} is empty.`)
    continue
  }
  const content = await readFile(file, "utf8")
  for (const forbidden of forbiddenValues) {
    if (content.includes(forbidden)) throw new Error(`${file} contains a forbidden sentinel value.`)
  }
}

console.log(JSON.stringify({ files: relativeFiles.sort(), root }))

if (process.argv.includes("--clean")) await rm(root, { force: true, recursive: true })

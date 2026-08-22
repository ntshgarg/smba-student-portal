import fs from "node:fs"

import { restoreEncryptedBackup } from "./backup-restore.mjs"

const [encryptedPath, workDirectory, outputPath] = process.argv.slice(2)
if (!encryptedPath || !workDirectory || !outputPath) {
  throw new Error("Usage: restore-backup-artifact <encrypted-file> <temporary-work-directory> <result-json>")
}

const restored = restoreEncryptedBackup({
  encryptedPath,
  passphrase: process.env.SMBA_BACKUP_PASSPHRASE ?? "",
  workDirectory,
})
fs.writeFileSync(outputPath, `${JSON.stringify(restored)}\n`, {
  encoding: "utf8",
  flag: "wx",
  mode: 0o600,
})

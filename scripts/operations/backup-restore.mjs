import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

import { verifyDatabaseSnapshot } from "./database-snapshot.mjs"

export const BACKUP_DATABASE_NAME = "smba-production.db"
export const BACKUP_MANIFEST_NAME = `${BACKUP_DATABASE_NAME}.manifest.json`
const EXPECTED_ARCHIVE_ENTRIES = [BACKUP_DATABASE_NAME, BACKUP_MANIFEST_NAME]

export function sha256File(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")
}

export function validateBackupArchiveEntries(entries) {
  if (!Array.isArray(entries) || entries.length !== EXPECTED_ARCHIVE_ENTRIES.length) {
    throw new Error("The backup archive must contain exactly the database and its manifest.")
  }
  const normalized = entries.map((entry) => String(entry))
  for (const entry of normalized) {
    if (!entry || path.isAbsolute(entry) || entry.includes("\\")) {
      throw new Error("The backup archive contains an unsafe path.")
    }
    const segments = entry.split("/")
    if (segments.includes("..") || segments.includes(".") || segments.length !== 1) {
      throw new Error("The backup archive contains an unsafe path.")
    }
  }
  if (JSON.stringify([...normalized].sort()) !== JSON.stringify([...EXPECTED_ARCHIVE_ENTRIES].sort())) {
    throw new Error("The backup archive contains unexpected files.")
  }
  return normalized
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    ...options,
  })
  if (result.status !== 0) {
    throw new Error(`${command} could not safely process the backup.`)
  }
  return result.stdout
}

export function inspectBackupArchive(archivePath) {
  const names = run("tar", ["-tzf", archivePath])
    .split(/\r?\n/u)
    .filter(Boolean)
  validateBackupArchiveEntries(names)

  const verbose = run("tar", ["-tvzf", archivePath])
    .split(/\r?\n/u)
    .filter(Boolean)
  if (verbose.length !== EXPECTED_ARCHIVE_ENTRIES.length || verbose.some((line) => line[0] !== "-")) {
    throw new Error("The backup archive must contain regular files only.")
  }
  return names
}

export function decryptBackupArtifact({ encryptedPath, outputPath, passphrase }) {
  if (typeof passphrase !== "string" || passphrase.length < 24) {
    throw new Error("A valid backup passphrase is required.")
  }
  if (fs.existsSync(outputPath)) {
    throw new Error("The decrypted backup destination already exists.")
  }
  const gpgRoot = fs.existsSync("/tmp") ? "/tmp" : os.tmpdir()
  const gpgHome = fs.mkdtempSync(path.join(gpgRoot, "smba-gpg-restore-"))
  fs.chmodSync(gpgHome, 0o700)
  const result = spawnSync("gpg", [
    "--homedir", gpgHome,
    "--batch",
    "--yes",
    "--pinentry-mode", "loopback",
    "--passphrase-fd", "0",
    "--output", outputPath,
    "--decrypt", encryptedPath,
  ], {
    encoding: "utf8",
    input: passphrase,
    maxBuffer: 1024 * 1024,
  })
  spawnSync("gpgconf", ["--homedir", gpgHome, "--kill", "gpg-agent"], {
    encoding: "utf8",
  })
  fs.rmSync(gpgHome, { force: true, recursive: true })
  if (result.status !== 0) {
    fs.rmSync(outputPath, { force: true })
    throw new Error("The encrypted backup could not be decrypted.")
  }
  fs.chmodSync(outputPath, 0o600)
  return outputPath
}

export function extractBackupArchive({ archivePath, destination }) {
  inspectBackupArchive(archivePath)
  if (fs.existsSync(destination) && fs.readdirSync(destination).length > 0) {
    throw new Error("The backup extraction destination must be empty.")
  }
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 })
  run("tar", [
    "-xzf", archivePath,
    "-C", destination,
    "--no-same-owner",
    "--no-same-permissions",
  ])
  const extracted = fs.readdirSync(destination)
  validateBackupArchiveEntries(extracted)
  for (const entry of extracted) {
    if (!fs.statSync(path.join(destination, entry)).isFile()) {
      throw new Error("The backup archive must contain regular files only.")
    }
  }
  return {
    manifestPath: path.join(destination, BACKUP_MANIFEST_NAME),
    snapshotPath: path.join(destination, BACKUP_DATABASE_NAME),
  }
}

export function restoreEncryptedBackup({ encryptedPath, passphrase, workDirectory }) {
  const resolvedWork = path.resolve(workDirectory)
  const temporaryRoot = path.resolve(process.env.RUNNER_TEMP || os.tmpdir())
  const relative = path.relative(temporaryRoot, resolvedWork)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("The restore workspace must live under the runner temporary directory.")
  }
  fs.mkdirSync(resolvedWork, { recursive: true, mode: 0o700 })
  fs.chmodSync(resolvedWork, 0o700)
  const archivePath = path.join(resolvedWork, "backup.tar.gz")
  const extractionPath = path.join(resolvedWork, "extracted")
  try {
    decryptBackupArtifact({ encryptedPath, outputPath: archivePath, passphrase })
    const paths = extractBackupArchive({ archivePath, destination: extractionPath })
    const verified = verifyDatabaseSnapshot(paths)
    return {
      ...paths,
      ciphertextSha256: sha256File(encryptedPath),
      snapshotSha256: verified.sha256,
    }
  } catch (error) {
    fs.rmSync(archivePath, { force: true })
    fs.rmSync(extractionPath, { force: true, recursive: true })
    throw error
  }
}

export function cleanupRestoreWorkspace(workDirectory) {
  const resolvedWork = path.resolve(workDirectory)
  const temporaryRoot = path.resolve(process.env.RUNNER_TEMP || os.tmpdir())
  const relative = path.relative(temporaryRoot, resolvedWork)
  if (!path.basename(resolvedWork).startsWith("smba-restore-")
    || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Refusing to clean an untrusted restore workspace.")
  }
  fs.rmSync(resolvedWork, { force: true, recursive: true })
}

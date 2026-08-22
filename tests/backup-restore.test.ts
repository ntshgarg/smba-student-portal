import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

import BetterSqlite3 from "better-sqlite3"
import { afterEach, describe, expect, it } from "vitest"

import {
  BACKUP_DATABASE_NAME,
  BACKUP_MANIFEST_NAME,
  cleanupRestoreWorkspace,
  restoreEncryptedBackup,
  validateBackupArchiveEntries,
} from "@/scripts/operations/backup-restore.mjs"
import { createDatabaseSnapshot } from "@/scripts/operations/database-snapshot.mjs"

const directories: string[] = []
const PASSPHRASE = "smba-test-passphrase-at-least-24-characters"

function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-backup-test-"))
  directories.push(directory)
  return directory
}

function requireCommand(result: ReturnType<typeof spawnSync>, command: string) {
  if (result.status !== 0) {
    throw new Error(`${command} failed while preparing the test fixture: ${String(result.stderr)}`)
  }
}

function encryptedFixture(directory: string, { tamperManifest = false } = {}) {
  const sourcePath = path.join(directory, "source.db")
  const snapshotPath = path.join(directory, BACKUP_DATABASE_NAME)
  const archivePath = path.join(directory, "backup.tar.gz")
  const encryptedPath = path.join(directory, "backup.tar.gz.gpg")
  const source = new BetterSqlite3(sourcePath)
  source.exec("CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT NOT NULL); INSERT INTO sample VALUES (1, 'verified');")
  source.close()
  createDatabaseSnapshot({ outputPath: snapshotPath, source: sourcePath })
  if (tamperManifest) {
    const manifestPath = `${snapshotPath}.manifest.json`
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { sha256: string }
    manifest.sha256 = "0".repeat(64)
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`)
  }
  requireCommand(spawnSync("tar", [
    "-czf", archivePath,
    "-C", directory,
    BACKUP_DATABASE_NAME,
    BACKUP_MANIFEST_NAME,
  ]), "tar")
  const gpgHome = fs.mkdtempSync("/tmp/smba-gpg-create-")
  fs.chmodSync(gpgHome, 0o700)
  requireCommand(spawnSync("gpg", [
    "--homedir", gpgHome,
    "--batch", "--yes", "--pinentry-mode", "loopback", "--passphrase-fd", "0",
    "--symmetric", "--cipher-algo", "AES256", "--output", encryptedPath, archivePath,
  ], { input: PASSPHRASE }), "gpg")
  spawnSync("gpgconf", ["--homedir", gpgHome, "--kill", "gpg-agent"])
  fs.rmSync(gpgHome, { force: true, recursive: true })
  return encryptedPath
}

afterEach(() => {
  delete process.env.RUNNER_TEMP
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true })
  }
})

describe.sequential("encrypted backup restoration", () => {
  it("decrypts, validates and extracts exactly one snapshot and manifest", () => {
    const root = temporaryDirectory()
    process.env.RUNNER_TEMP = root
    const encryptedPath = encryptedFixture(root)
    const workDirectory = path.join(root, "smba-restore-valid")
    const restored = restoreEncryptedBackup({ encryptedPath, passphrase: PASSPHRASE, workDirectory })

    expect(fs.existsSync(restored.snapshotPath)).toBe(true)
    expect(fs.existsSync(restored.manifestPath)).toBe(true)
    expect(restored.ciphertextSha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(restored.snapshotSha256).toMatch(/^[a-f0-9]{64}$/u)

    cleanupRestoreWorkspace(workDirectory)
    expect(fs.existsSync(workDirectory)).toBe(false)
  })

  it("rejects a wrong passphrase and removes partial plaintext", () => {
    const root = temporaryDirectory()
    process.env.RUNNER_TEMP = root
    const encryptedPath = encryptedFixture(root)
    const workDirectory = path.join(root, "smba-restore-wrong-passphrase")

    expect(() => restoreEncryptedBackup({
      encryptedPath,
      passphrase: "wrong-passphrase-that-is-still-long-enough",
      workDirectory,
    })).toThrow("could not be decrypted")
    expect(fs.existsSync(path.join(workDirectory, "backup.tar.gz"))).toBe(false)
    expect(fs.existsSync(path.join(workDirectory, "extracted"))).toBe(false)
  })

  it("rejects tampered ciphertext and removes partial plaintext", () => {
    const root = temporaryDirectory()
    process.env.RUNNER_TEMP = root
    const encryptedPath = encryptedFixture(root)
    const bytes = fs.readFileSync(encryptedPath)
    bytes[Math.floor(bytes.length / 2)] ^= 0xff
    fs.writeFileSync(encryptedPath, bytes)
    const workDirectory = path.join(root, "smba-restore-tampered")

    expect(() => restoreEncryptedBackup({ encryptedPath, passphrase: PASSPHRASE, workDirectory }))
      .toThrow("could not be decrypted")
    expect(fs.existsSync(path.join(workDirectory, "backup.tar.gz"))).toBe(false)
  })

  it("rejects a tampered snapshot manifest and removes extracted plaintext", () => {
    const root = temporaryDirectory()
    process.env.RUNNER_TEMP = root
    const encryptedPath = encryptedFixture(root, { tamperManifest: true })
    const workDirectory = path.join(root, "smba-restore-tampered-manifest")

    expect(() => restoreEncryptedBackup({ encryptedPath, passphrase: PASSPHRASE, workDirectory }))
      .toThrow("checksum does not match")
    expect(fs.existsSync(path.join(workDirectory, "backup.tar.gz"))).toBe(false)
    expect(fs.existsSync(path.join(workDirectory, "extracted"))).toBe(false)
  })

  it("rejects traversal, absolute, nested and unexpected archive entries", () => {
    expect(() => validateBackupArchiveEntries(["../smba-production.db", BACKUP_MANIFEST_NAME]))
      .toThrow("unsafe path")
    expect(() => validateBackupArchiveEntries(["/smba-production.db", BACKUP_MANIFEST_NAME]))
      .toThrow("unsafe path")
    expect(() => validateBackupArchiveEntries(["nested/smba-production.db", BACKUP_MANIFEST_NAME]))
      .toThrow("unsafe path")
    expect(() => validateBackupArchiveEntries([BACKUP_DATABASE_NAME, "unexpected.json"]))
      .toThrow("unexpected files")
  })

  it("refuses cleanup outside a trusted temporary restore directory", () => {
    expect(() => cleanupRestoreWorkspace(path.join(process.cwd(), "smba-restore-danger")))
      .toThrow("Refusing to clean")
  })
})

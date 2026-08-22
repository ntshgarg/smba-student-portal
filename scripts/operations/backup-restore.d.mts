export const BACKUP_DATABASE_NAME: string
export const BACKUP_MANIFEST_NAME: string

export function sha256File(filePath: string): string

export function validateBackupArchiveEntries(entries: unknown[]): string[]

export function inspectBackupArchive(archivePath: string): string[]

export function decryptBackupArtifact(input: {
  encryptedPath: string
  outputPath: string
  passphrase: string
}): string

export function extractBackupArchive(input: {
  archivePath: string
  destination: string
}): {
  manifestPath: string
  snapshotPath: string
}

export function restoreEncryptedBackup(input: {
  encryptedPath: string
  passphrase: string
  workDirectory: string
}): {
  ciphertextSha256: string
  manifestPath: string
  snapshotPath: string
  snapshotSha256: string
}

export function cleanupRestoreWorkspace(workDirectory: string): void

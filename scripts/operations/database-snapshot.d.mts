export type DatabaseSnapshotManifest = {
  createdAt: string
  file: string
  rowCounts: Record<string, number>
  schemaObjects: number
  sha256: string
  source: "local" | "remote"
}

export function createDatabaseSnapshot(input: {
  authToken?: string
  outputPath: string
  source: string
}): {
  manifest: DatabaseSnapshotManifest
  manifestPath: string
  snapshotPath: string
}

export function verifyDatabaseSnapshot(input: {
  manifestPath?: string
  snapshotPath: string
}): {
  checkedAt: string
  file: string
  sha256: string
  tables: number
}

import { existsSync, realpathSync } from "node:fs"
import os from "node:os"
import path from "node:path"

export function assertDisposableAccessibilityDatabase(databasePath: string | undefined) {
  if (!databasePath) {
    throw new Error("SMBA_ACCESSIBILITY_DB is required.")
  }
  if (!path.isAbsolute(databasePath)) {
    throw new Error("SMBA_ACCESSIBILITY_DB must be an absolute path.")
  }
  if (!existsSync(databasePath)) {
    throw new Error(`SMBA_ACCESSIBILITY_DB does not exist: ${databasePath}`)
  }
  const realDatabasePath = realpathSync(databasePath)
  const temporaryRoots = new Set([
    realpathSync(os.tmpdir()),
    realpathSync("/tmp"),
  ])
  const isDisposablePath = [...temporaryRoots].some((temporaryRoot) => {
    const relative = path.relative(temporaryRoot, realDatabasePath)
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  })
  if (!isDisposablePath) {
    throw new Error("SMBA_ACCESSIBILITY_DB must be a disposable database under the system temporary directory.")
  }
  if (!/smba[-_.].*accessibility|smba-accessibility|smba-a11y/u.test(path.basename(realDatabasePath))) {
    throw new Error("SMBA_ACCESSIBILITY_DB must have an accessibility-specific filename.")
  }
  return realDatabasePath
}

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import BetterSqlite3 from "better-sqlite3"

function inside(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function containsDataDirectory(candidate: string) {
  return path.resolve(candidate).split(path.sep).includes(".data")
}

export function assertDisposableFinanceFixturePaths(source: string, target: string) {
  const resolvedSource = path.resolve(source)
  const resolvedTarget = path.resolve(target)
  const temporaryRoots = [path.resolve(os.tmpdir()), path.resolve("/tmp")]

  if (!fs.existsSync(resolvedSource) || !fs.statSync(resolvedSource).isFile()) {
    throw new Error("The clean finance fixture source must be an existing regular file.")
  }
  if (!temporaryRoots.some((root) => inside(root, resolvedTarget))) {
    throw new Error("The finance regression database must live under the operating-system temporary directory.")
  }
  if (containsDataDirectory(resolvedTarget)) {
    throw new Error("The finance regression database must never be created inside a .data directory.")
  }
  if (resolvedSource === resolvedTarget) {
    throw new Error("The clean source and finance regression target must be different files.")
  }

  if (fs.existsSync(resolvedTarget)) {
    const sourceStat = fs.statSync(resolvedSource)
    const targetStat = fs.statSync(resolvedTarget)
    if (sourceStat.dev === targetStat.dev && sourceStat.ino === targetStat.ino) {
      throw new Error("The finance regression target must not be a hard link to its clean source.")
    }
    throw new Error("The finance regression target already exists; choose a new disposable path.")
  }

  return { source: resolvedSource, target: resolvedTarget }
}

export function verifyFinanceFixtureDatabase(databasePath: string) {
  const database = new BetterSqlite3(databasePath, { fileMustExist: true, readonly: true })
  try {
    const integrity = database.pragma("integrity_check", { simple: true })
    if (integrity !== "ok") throw new Error(`Finance fixture integrity check failed: ${integrity}`)
    const foreignKeys = database.pragma("foreign_key_check") as unknown[]
    if (foreignKeys.length) {
      throw new Error(`Finance fixture contains ${foreignKeys.length} foreign-key violation(s).`)
    }
    return { foreignKeys: "ok" as const, integrity: "ok" as const }
  } finally {
    database.close()
  }
}

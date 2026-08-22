import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import BetterSqlite3 from "better-sqlite3"
import { afterEach, describe, expect, it } from "vitest"

import {
  assertDisposableFinanceFixturePaths,
  verifyFinanceFixtureDatabase,
} from "../scripts/regression/finance-fixture-support"

const temporaryDirectories: string[] = []

function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-finance-path-"))
  temporaryDirectories.push(directory)
  return directory
}

function healthyDatabase(file: string) {
  const database = new BetterSqlite3(file)
  database.pragma("foreign_keys = ON")
  database.exec("create table parent (id text primary key); create table child (parent_id text references parent(id));")
  database.close()
}

afterEach(() => {
  while (temporaryDirectories.length) {
    fs.rmSync(temporaryDirectories.pop()!, { force: true, recursive: true })
  }
})

describe("finance regression fixture isolation", () => {
  it("accepts a new target under the operating-system temporary directory", () => {
    const directory = temporaryDirectory()
    const source = path.join(directory, "source.db")
    healthyDatabase(source)

    expect(assertDisposableFinanceFixturePaths(source, path.join(directory, "target.db")))
      .toMatchObject({ source: path.resolve(source) })
    expect(verifyFinanceFixtureDatabase(source)).toEqual({ foreignKeys: "ok", integrity: "ok" })
  })

  it("rejects repository targets, .data targets, identical files and hard links", () => {
    const directory = temporaryDirectory()
    const source = path.join(directory, "source.db")
    healthyDatabase(source)
    const hardLink = path.join(directory, "hard-link.db")
    fs.linkSync(source, hardLink)

    expect(() => assertDisposableFinanceFixturePaths(source, path.resolve("finance.db")))
      .toThrow(/temporary directory/u)
    expect(() => assertDisposableFinanceFixturePaths(source, path.join(directory, ".data", "finance.db")))
      .toThrow(/\.data/u)
    expect(() => assertDisposableFinanceFixturePaths(source, source)).toThrow(/different files/u)
    expect(() => assertDisposableFinanceFixturePaths(source, hardLink)).toThrow(/hard link/u)
  })
})

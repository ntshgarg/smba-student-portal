import { spawnSync } from "node:child_process"
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

// SEC-3a (security.md §3.3): the production Turso credentials were world-readable
// in `.env.local` and `.env.production.local`, and `.env.local` — the file
// `db:reset:academy` and `db:provision:admin` load (package.json:9-10) — carried the
// production `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`. The chmod, the strip and the
// token rotation are operational work; this file is the regression gate that stops
// any of it silently coming back.
//
// Both env files are untracked, so they are absent from a fresh clone and from CI.
// Every on-disk assertion below therefore skips when its file is absent, and the
// second describe block proves — against fixtures in a temp directory — that the
// checks actually fire when a file *is* present and non-compliant. A gate that only
// ever sees absent files proves nothing.
//
// Scope, per fix-plan.md §3.2: env files only. security.md §7.4 also proposed
// asserting here that `authSecret()` rejects the four published secrets of §6.5.
// That is deliberately NOT in this file — it is P2 finding 15, it belongs in the
// existing tests/auth-secret-policy.test.ts, and asserting it here would pull
// lib/auth/better-auth.ts (a shared auth primitive) into a P0 lane.
//
// Kept separate from tests/repo-hygiene.test.ts (SEC-1) on purpose: merging the two
// would put `.gitignore` work and `.env.local` work in one file and collapse two
// independent lanes into one.

const repositoryRoot = path.resolve(import.meta.dirname, "..")

/** The untracked env files SEC-3a hardens. Both must be owner-only if present. */
const PROTECTED_ENV_FILES = [".env.local", ".env.production.local"] as const

/** The two keys SEC-3a strips out of `.env.local`. */
const PRODUCTION_DATABASE_KEYS = ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"] as const

/** `chmod` is not meaningful on Windows, so the mode fixtures only run elsewhere. */
const supportsFileModes = process.platform !== "win32"

/**
 * Permission bits of `file`, or `undefined` when it does not exist.
 *
 * `statSync` follows symlinks deliberately: a `.env.local` symlinked to a 0644 file
 * is exactly the exposure §3.3 describes, so the target's mode is the one that counts.
 */
function permissionBits(file: string): number | undefined {
  const stats = statSync(file, { throwIfNoEntry: false })
  return stats === undefined ? undefined : stats.mode & 0o777
}

function isPresent(file: string): boolean {
  return permissionBits(file) !== undefined
}

function formatMode(bits: number): string {
  return `0${(bits & 0o777).toString(8).padStart(3, "0")}`
}

/** Group- or other-readable/writable/executable — the property SEC-3a removes. */
function sharedBits(bits: number): number {
  return bits & 0o077
}

const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/u

/**
 * The names of the variables an env file defines — **names only**.
 *
 * Everything after the first `=` is dropped here and never reaches an assertion, a
 * failure message or the console. Nothing in this file may surface a secret value;
 * the only things asserted on anywhere below are key names, file modes and ignore
 * rules.
 */
function keysDefinedIn(contents: string): string[] {
  const keys: string[] = []

  for (const line of contents.split(/\r?\n/u)) {
    if (/^\s*(?:#|$)/u.test(line)) continue
    const match = ASSIGNMENT.exec(line)
    if (match !== null) keys.push(match[1])
  }

  return keys
}

function globToRegExp(pattern: string): RegExp {
  const body = pattern
    .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
    .replace(/\*/gu, "[^/]*")
    .replace(/\?/gu, "[^/]")
  return new RegExp(`^${body}$`, "u")
}

/** Whether one `.gitignore` pattern matches a file sitting at the repository root. */
function patternMatchesRootName(pattern: string, name: string): boolean {
  const withoutTrailingSlash = pattern.replace(/\/+$/u, "")
  const anchored = withoutTrailingSlash.startsWith("/")
    ? withoutTrailingSlash.slice(1)
    : withoutTrailingSlash
  // A pattern with an interior slash addresses a nested path and cannot cover a
  // root-level file, so `docs/.env*` must not be read as protecting `.env.local`.
  if (anchored === "" || anchored.includes("/")) return false
  return globToRegExp(anchored).test(name)
}

/**
 * Whether `.gitignore` ignores a root-level file called `name`.
 *
 * Last matching rule wins, and a `!` rule un-ignores — which is how `.env*` plus
 * `!.env.example` is meant to behave, and how a careless `!.env.local` would silently
 * un-protect the file this test exists to protect.
 */
function ignoresRootName(gitignore: string, name: string): boolean {
  let ignored = false

  for (const raw of gitignore.split(/\r?\n/u)) {
    const line = raw.trim()
    if (line === "" || line.startsWith("#")) continue
    const negated = line.startsWith("!")
    const pattern = negated ? line.slice(1) : line
    if (patternMatchesRootName(pattern, name)) ignored = !negated
  }

  return ignored
}

const gitAvailable =
  spawnSync("git", ["-C", repositoryRoot, "rev-parse", "--is-inside-work-tree"], {
    encoding: "utf8",
  }).status === 0

/** `true`/`false` from `git check-ignore`, or `undefined` if git could not answer. */
function gitConsidersIgnored(relative: string): boolean | undefined {
  const result = spawnSync("git", ["-C", repositoryRoot, "check-ignore", "-q", "--", relative], {
    encoding: "utf8",
  })
  if (result.status === 0) return true
  if (result.status === 1) return false
  return undefined
}

describe("env files on disk (SEC-3a)", () => {
  for (const relative of PROTECTED_ENV_FILES) {
    const absolute = path.join(repositoryRoot, relative)
    const present = isPresent(absolute)

    it.skipIf(!present)(`${relative} is owner-only`, () => {
      const bits = permissionBits(absolute) ?? 0

      expect(
        formatMode(sharedBits(bits)),
        `${relative} is mode ${formatMode(bits)}; SEC-3a requires 0600 (chmod 600 ${relative})`,
      ).toBe("0000")
    })
  }

  const envLocal = path.join(repositoryRoot, ".env.local")
  const envLocalPresent = isPresent(envLocal)

  it.skipIf(!envLocalPresent)(".env.local defines no production Turso credentials", () => {
    // Only key names leave this read; see keysDefinedIn.
    const keys = keysDefinedIn(readFileSync(envLocal, "utf8"))

    for (const key of PRODUCTION_DATABASE_KEYS) {
      expect(
        keys,
        `.env.local defines ${key}. db:reset:academy and db:provision:admin load this file, ` +
          "so a stray SMBA_USE_TURSO=true would point an irreversible wipe at the live academy.",
      ).not.toContain(key)
    }
  })

  it.skipIf(!envLocalPresent)(".env.local defines no TURSO_ variable at all", () => {
    const turso = keysDefinedIn(readFileSync(envLocal, "utf8")).filter((key) =>
      key.startsWith("TURSO_"),
    )

    expect(turso, "security.md §7.4: .env.local must carry no TURSO_ key").toEqual([])
  })

  it("keeps both env files covered by .gitignore", () => {
    const gitignore = readFileSync(path.join(repositoryRoot, ".gitignore"), "utf8")

    for (const relative of PROTECTED_ENV_FILES) {
      expect(ignoresRootName(gitignore, relative), `.gitignore stopped covering ${relative}`).toBe(
        true,
      )
    }

    // The single intended exemption. If this ever widens to `!.env*` the rule above
    // becomes decorative, so pin it.
    expect(ignoresRootName(gitignore, ".env.example")).toBe(false)
  })

  it.skipIf(!gitAvailable)("agrees with git about what is ignored", () => {
    for (const relative of PROTECTED_ENV_FILES) {
      const ignored = gitConsidersIgnored(relative)
      if (ignored === undefined) continue
      expect(ignored, `git check-ignore says ${relative} is not ignored`).toBe(true)
    }
  })
})

describe("the hygiene checks fire on a non-compliant file", () => {
  // Fixtures only. No value written here resembles a credential, and none is asserted
  // on — these exist to prove the checks above are not vacuous when the real env files
  // are absent, which is their normal state in a clone and in CI.
  let workspace: string

  beforeAll(() => {
    workspace = mkdtempSync(path.join(os.tmpdir(), "smba-env-hygiene-"))
  })

  afterAll(() => {
    rmSync(workspace, { force: true, recursive: true })
  })

  function fixture(name: string, contents: string, mode?: number): string {
    const file = path.join(workspace, name)
    writeFileSync(file, contents)
    if (mode !== undefined) chmodSync(file, mode)
    return file
  }

  it.skipIf(!supportsFileModes)("accepts an owner-only env file", () => {
    const file = fixture("compliant.env", "DB_FILE_NAME=.data/academy-empty.db\n", 0o600)

    expect(formatMode(permissionBits(file) ?? 0)).toBe("0600")
    expect(sharedBits(permissionBits(file) ?? 0)).toBe(0)
  })

  it.skipIf(!supportsFileModes)("rejects world- and group-readable env files", () => {
    for (const mode of [0o644, 0o640, 0o604, 0o666, 0o755]) {
      const file = fixture(`mode-${mode.toString(8)}.env`, "DB_FILE_NAME=x\n", mode)

      expect(permissionBits(file)).toBe(mode)
      expect(sharedBits(permissionBits(file) ?? 0), `${formatMode(mode)} slipped through`).not.toBe(
        0,
      )
    }
  })

  it("reports an env file that is absent rather than throwing", () => {
    expect(permissionBits(path.join(workspace, "definitely-not-here.env"))).toBeUndefined()
    expect(isPresent(path.join(workspace, "definitely-not-here.env"))).toBe(false)
  })

  it("finds the forbidden keys when they are present", () => {
    const contents = [
      "DB_FILE_NAME=.data/academy-empty.db",
      "TURSO_DATABASE_URL=libsql://fixture.example.invalid",
      "  export TURSO_AUTH_TOKEN = placeholder",
      "",
    ].join("\n")

    const keys = keysDefinedIn(contents)

    expect(keys).toContain("TURSO_DATABASE_URL")
    expect(keys).toContain("TURSO_AUTH_TOKEN")
    expect(keys.filter((key) => key.startsWith("TURSO_"))).toHaveLength(2)
  })

  it("reads key names only, and never the values behind them", () => {
    const keys = keysDefinedIn("TURSO_AUTH_TOKEN=placeholder-value-1234\nDB_FILE_NAME=local.db\n")

    expect(keys).toEqual(["TURSO_AUTH_TOKEN", "DB_FILE_NAME"])
    expect(keys.join("\n")).not.toContain("placeholder-value-1234")
    expect(keys.join("\n")).not.toContain("local.db")
  })

  it("does not mistake comments or lookalike names for a definition", () => {
    const contents = [
      "# TURSO_DATABASE_URL=libsql://commented.example.invalid",
      "#TURSO_AUTH_TOKEN=commented",
      "SMBA_TURSO_DATABASE_URL_NOTE=unrelated",
      "TURSO_DATABASE_URL_BACKUP=unrelated",
      "",
    ].join("\n")

    const keys = keysDefinedIn(contents)

    expect(keys).not.toContain("TURSO_DATABASE_URL")
    expect(keys).not.toContain("TURSO_AUTH_TOKEN")
  })

  it("catches a .gitignore that stopped covering the env files", () => {
    const covering = ".env*\n!.env.example\n"

    expect(ignoresRootName(covering, ".env.local")).toBe(true)
    expect(ignoresRootName(covering, ".env.production.local")).toBe(true)
    expect(ignoresRootName(covering, ".env.example")).toBe(false)

    // Rule deleted outright.
    expect(ignoresRootName("/node_modules\n*.log\n", ".env.local")).toBe(false)
    // Rule narrowed to the bare file name.
    expect(ignoresRootName(".env\n", ".env.local")).toBe(false)
    // Negation widened past the example file.
    expect(ignoresRootName(".env*\n!.env.local\n", ".env.local")).toBe(false)
    expect(ignoresRootName(".env*\n!.env*\n", ".env.production.local")).toBe(false)
    // A nested rule does not protect the repository root.
    expect(ignoresRootName("docs/.env*\n", ".env.local")).toBe(false)
    // Order matters: a later re-ignore wins over an earlier negation.
    expect(ignoresRootName("!.env.local\n.env*\n", ".env.local")).toBe(true)
  })
})

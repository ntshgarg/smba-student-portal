import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

const repositoryRoot = path.resolve(import.meta.dirname, "..")
const NUL = String.fromCharCode(0)

// Bigger than this, or holding a NUL byte, means a build artifact, an archive or
// a screenshot rather than a credential file. Reading them buys nothing and the
// audit screenshots alone would triple the scan.
const MAX_SCANNED_BYTES = 2 * 1024 * 1024
/**
 * The whole-tree scans read every tracked file synchronously. That is well under
 * a second on a warm page cache but has been measured above vitest's 5s default
 * on a cold clone, which is exactly the CI case — and `test:ci` runs
 * `--maxWorkers=2`, so the two scans contend. Budget generously; this guards a
 * timeout, it is not a performance assertion.
 */
const WHOLE_TREE_SCAN_TIMEOUT_MS = 30_000

// A credential *store* is a data artifact. Source and test files legitimately
// carry the words "password" and "secret" beside fixture values, so the
// state-file rule below is confined to these extensions (and to extensionless
// files); the live-value rules apply everywhere.
const DATA_FILE = /\.(?:json|jsonc|ya?ml|txt|csv|ini|cfg|conf|env|log|har)$/iu

// Every rule matches key material by *shape*, never by keyword. That is
// deliberate: the tree holds ~15 files with a placeholder or CI-only value
// (`BETTER_AUTH_SECRET: smba-ci-only-secret-never-used-in-production-2026`,
// `TURSO_AUTH_TOKEN=<production-token>` in the audit prose, `re_test_key`), and
// a keyword scan reports all of them, so it would have to be switched off the
// day it was written. Base32 is A-Z2-7; 26 characters clears the canonical
// 16-character test seed (JBSWY3DPEHPK3PXP) and still catches the 32- and
// 52-character seeds a real authenticator emits.
const LIVE_CREDENTIAL_RULES: ReadonlyArray<{ name: string, pattern: RegExp }> = [
  {
    name: "base32-secret-assignment",
    pattern: /["']?\b(?:secret|seed|totp[_-]?secret)["']?\s*[:=]\s*["']?[A-Z2-7]{26,}={0,6}\b/gu,
  },
  {
    name: "otpauth-enrolment-uri",
    pattern: /otpauth:\/\/[a-z]+\/[^\s"'`]*[?&]secret=[A-Za-z2-7]{26,}/giu,
  },
  {
    name: "json-web-token",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/gu,
  },
  {
    name: "bearer-token",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{24,}={0,2}/gu,
  },
  {
    name: "private-key-block",
    pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/gu,
  },
]

// The shape of flowtest/state.json itself: one data file assigning values to two
// or more distinct credential fields.
const CREDENTIAL_FIELD = /["']?\b(password|passphrase|pin|secret|seed|totp)["']?\s*:\s*["'][^"'\n]{6,}["']/giu

// Assembled rather than written out, so this file contains no seed-shaped
// literal and therefore does not report itself. 32 base32 characters.
const SYNTHETIC_SEED = "JBSWY3DPEHPK3PXP".repeat(2)

function syntheticFlowtestState() {
  return JSON.stringify(
    {
      owner: { academyId: "SMBA-ADMIN-0001", password: "synthetic-owner-password", secret: SYNTHETIC_SEED },
      headCoach: { password: "synthetic-coach-password", pin: "123456", secret: SYNTHETIC_SEED },
    },
    null,
    2,
  )
}

function git(...args: string[]) {
  return execFileSync("git", ["--no-optional-locks", ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
}

function isIgnored(relativePath: string) {
  // --no-index answers from the ignore rules alone, so a tracked path is not
  // silently reported as "not ignored" for the wrong reason.
  const result = spawnSync(
    "git",
    ["--no-optional-locks", "check-ignore", "--quiet", "--no-index", "--", relativePath],
    { cwd: repositoryRoot, encoding: "utf8" },
  )
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git check-ignore failed for ${relativePath}: ${String(result.stderr)}`)
  }
  return result.status === 0
}

function trackedFiles() {
  return git("ls-files", "-z").split(NUL).filter(Boolean)
}

function untrackedUnignoredFiles() {
  return git("status", "--porcelain", "-uall", "-z")
    .split(NUL)
    .filter((entry) => entry.startsWith("?? "))
    .map((entry) => entry.slice(3))
}

/** Rule names only — a finding must never print the material it found. */
function credentialFindings(file: string, contents: string) {
  const findings: string[] = []
  for (const rule of LIVE_CREDENTIAL_RULES) {
    rule.pattern.lastIndex = 0
    if (rule.pattern.test(contents)) findings.push(rule.name)
  }
  if (DATA_FILE.test(file) || !path.basename(file).includes(".")) {
    CREDENTIAL_FIELD.lastIndex = 0
    const fields = new Set(
      [...contents.matchAll(CREDENTIAL_FIELD)].map((match) => match[1].toLowerCase()),
    )
    if (fields.size >= 2) findings.push("credential-state-file")
  }
  return findings
}

function scanForCredentials(files: readonly string[]) {
  const reports: string[] = []
  for (const file of files) {
    const absolute = path.join(repositoryRoot, file)
    let stats: fs.Stats
    try {
      stats = fs.statSync(absolute)
    } catch {
      continue
    }
    if (!stats.isFile() || stats.size > MAX_SCANNED_BYTES) continue
    let contents: string
    try {
      contents = fs.readFileSync(absolute, "utf8")
    } catch {
      continue
    }
    if (contents.includes(NUL)) continue
    for (const finding of credentialFindings(file, contents)) reports.push(`${file}: ${finding}`)
  }
  return reports
}

describe("repository hygiene", () => {
  it("ignores the end-to-end flow harness that holds live credentials", () => {
    const gitignore = fs.readFileSync(path.join(repositoryRoot, ".gitignore"), "utf8")

    expect(gitignore).toMatch(/^\/flowtest$/mu)
    expect(isIgnored("flowtest")).toBe(true)
    expect(isIgnored("flowtest/state.json")).toBe(true)
    expect(isIgnored("flowtest/scripts/sign-in-as-owner.mjs")).toBe(true)
    // Control: the rule is a rule, not `check-ignore` answering 0 for everything.
    expect(isIgnored("package.json")).toBe(false)
    expect(isIgnored("tests/repo-hygiene.test.ts")).toBe(false)
  })

  it("keeps a recreated flowtest state file out of everything git add -A would stage", () => {
    const harness = path.join(repositoryRoot, "flowtest")
    // If a harness is already on disk it is the operator's, and may hold real
    // credentials: assert against it, never write to or delete it.
    const created = !fs.existsSync(harness)
    try {
      if (created) {
        fs.mkdirSync(harness, { recursive: true })
        fs.writeFileSync(path.join(harness, "state.json"), syntheticFlowtestState(), "utf8")
      }
      expect(untrackedUnignoredFiles().filter((file) => file.startsWith("flowtest"))).toEqual([])
    } finally {
      if (created) fs.rmSync(harness, { recursive: true, force: true })
    }
  })

  it("has never committed the flow harness", () => {
    expect(git("ls-files", "-z", "--", "flowtest").trim()).toBe("")
    expect(git("log", "--all", "--diff-filter=A", "--name-only", "--pretty=format:", "--", "flowtest").trim())
      .toBe("")
  })

  it("holds no tracked file with the shape of a live credential", () => {
    expect(scanForCredentials(trackedFiles())).toEqual([])
  }, WHOLE_TREE_SCAN_TIMEOUT_MS)

  it("leaves no unignored working-tree file with the shape of a live credential", () => {
    // The narrowed form of the flowtest finding: an ignore rule protects one
    // known path, this protects the class. Deliberately not "git status is
    // empty" — untracked documentation and screenshots are normal, and a test
    // that fails on those is a test that gets deleted.
    expect(scanForCredentials(untrackedUnignoredFiles())).toEqual([])
  }, WHOLE_TREE_SCAN_TIMEOUT_MS)

  it("recognises a credential store and not its documentation", () => {
    expect(credentialFindings("flowtest/state.json", syntheticFlowtestState()))
      .toEqual(["base32-secret-assignment", "credential-state-file"])

    // Negative controls, all present in the tree today.
    expect(credentialFindings("docs/audit/security.md", [
      "TURSO_AUTH_TOKEN=<production-token>",
      "BETTER_AUTH_SECRET: smba-ci-only-secret-never-used-in-production-2026",
      "otpauth://totp/SMBA:coach?secret=JBSWY3DPEHPK3PXP&issuer=SMBA",
      '"password": "x"',
    ].join("\n"))).toEqual([])
    expect(credentialFindings("tests/authenticator-reset-service.test.ts", [
      'password: "preserved-password-hash",',
      'secret: "encrypted-secret",',
    ].join("\n"))).toEqual([])
    expect(credentialFindings(".env.example", "RESEND_API_KEY=\nSMBA_AUTH_EMAIL_FROM=SMBA")).toEqual([])
  })
})

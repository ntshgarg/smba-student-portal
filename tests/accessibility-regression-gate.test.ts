import { closeSync, mkdtempSync, openSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  buildAccessibilitySummary,
  formatAccessibilityFailures,
  sanitizeAccessibilityText,
  type AccessibilityResult,
} from "./e2e/support/accessibility-audit"
import { assertDisposableAccessibilityDatabase } from "./e2e/support/accessibility-environment"
import {
  accessibilityProfiles,
  accessibilityStates,
  accessibilityViewports,
  statesForProfile,
  viewportsForState,
} from "./e2e/support/accessibility-matrix"

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

function resultWithFinding(): AccessibilityResult {
  return {
    actor: "guest",
    description: "Test state",
    findings: [{
      id: "button-name",
      impact: "critical",
      message: "Button has no accessible name",
      source: "axe",
      targets: ["button"],
    }],
    id: "test-state",
    profile: "admin",
    route: "/test",
    title: "Test",
    url: "http://127.0.0.1/test",
    viewport: accessibilityViewports[0],
  }
}

describe("accessibility regression matrix", () => {
  it("uses unique state identifiers and covers every database profile", () => {
    const ids = accessibilityStates.map((state) => state.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const profile of accessibilityProfiles) {
      expect(statesForProfile(profile).length).toBeGreaterThan(0)
    }
  })

  it("runs each state at web, tablet, and mobile widths", () => {
    for (const state of accessibilityStates) {
      const widths = viewportsForState(state).map((viewport) => viewport.width)
      expect(widths).toEqual(expect.arrayContaining([1440, 820, 390]))
      if (state.compact) expect(widths).toContain(320)
    }
  })

  it("keeps the approved authentication and role surfaces in the matrix", () => {
    const ids = new Set(accessibilityStates.map((state) => state.id))
    for (const id of [
      "admin-authenticator-reconnect",
      "admin-authenticator-recovery-approval",
      "admin-recovery-email-setup",
      "junior-coach-personal-attendance",
      "player-announcement-detail",
      "player-attendance",
    ]) {
      expect(ids.has(id), `${id} is missing from the accessibility matrix`).toBe(true)
    }
  })
})

describe("accessibility evidence", () => {
  it("redacts email addresses, long secrets, and sensitive URL parameters", () => {
    const source = "person@example.com ABCDEFGHIJKLMNOPQRSTUVWXYZ234567 token=secret-value PIN: 246810 password=hunter2"
    const sanitized = sanitizeAccessibilityText(source)
    expect(sanitized).not.toContain("person@example.com")
    expect(sanitized).not.toContain("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")
    expect(sanitized).not.toContain("secret-value")
    expect(sanitized).not.toContain("246810")
    expect(sanitized).not.toContain("hunter2")
  })

  it("aggregates failures and creates a concise GitHub summary", () => {
    const result = resultWithFinding()
    expect(formatAccessibilityFailures([result])).toEqual([
      "test-state · web · critical · button-name: Button has no accessible name [button]",
    ])
    expect(buildAccessibilitySummary([result])).toContain("- Findings: 1")
    expect(buildAccessibilitySummary([{ ...result, findings: [] }]))
      .toContain("All audited states passed")
  })
})

describe("accessibility database guard", () => {
  it("accepts only an existing accessibility database under the system temp directory", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "smba-a11y-guard-"))
    temporaryDirectories.push(directory)
    const database = path.join(directory, "smba-a11y-test.db")
    closeSync(openSync(database, "w", 0o600))
    expect(assertDisposableAccessibilityDatabase(database)).toBe(path.resolve(database).replace(/^\/var\//u, "/private/var/"))
  })

  it("accepts a guarded accessibility database under the portable /tmp root", () => {
    const directory = mkdtempSync("/tmp/smba-a11y-guard-")
    temporaryDirectories.push(directory)
    const database = path.join(directory, "smba-accessibility-test.db")
    closeSync(openSync(database, "w", 0o600))
    expect(assertDisposableAccessibilityDatabase(database)).toBe(path.resolve(database).replace(/^\/tmp\//u, "/private/tmp/"))
  })

  it("rejects relative and non-temporary database paths", () => {
    expect(() => assertDisposableAccessibilityDatabase(".data/academy-clean.db"))
      .toThrow("must be an absolute path")
    expect(() => assertDisposableAccessibilityDatabase(path.resolve("package.json")))
      .toThrow("system temporary directory")
  })
})

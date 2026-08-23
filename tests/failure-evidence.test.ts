import { describe, expect, it } from "vitest"

import {
  sanitizeFailureText,
  sanitizeFailureUrl,
} from "../scripts/regression/failure-evidence-sanitizer"

describe("sanitized Playwright failure evidence", () => {
  it("removes credentials and account recovery material from text", () => {
    const source = "email=coach@example.com password=hunter2 pin:246810 token=abc123 SMBA-HC-0001"
    const sanitized = sanitizeFailureText(source)

    expect(sanitized).not.toContain("coach@example.com")
    expect(sanitized).not.toContain("hunter2")
    expect(sanitized).not.toContain("246810")
    expect(sanitized).not.toContain("abc123")
    expect(sanitized).not.toContain("SMBA-HC-0001")
  })

  it("removes sensitive query parameters, URL credentials and fragments", () => {
    const sanitized = sanitizeFailureUrl(
      "https://user:pass@example.test/recover?token=secret&view=compact&email=coach%40example.com#backup-code",
    )

    expect(sanitized).toBe("https://example.test/recover?view=compact")
  })
})

// The email rule's quantifiers are bounded to stop it running in quadratic time
// on caller-supplied text (js/polynomial-redos). Bounding a quantifier is exactly
// the kind of change that can quietly narrow what a rule matches, so the shapes
// that motivated the original character classes are pinned here.
describe("the bounded email rule still redacts every address shape", () => {
  it("keeps redacting each character the local part and domain classes allow", () => {
    for (const address of [
      "coach@example.com",
      "aarav.guardian@example.com",
      "parent+tag@academy.example.org",
      "a_b@example.com",
      "first-last@sub.domain.co.uk",
      "100%sure@example.com",
      "UPPER.CASE@EXAMPLE.COM",
      "coach@fees-portal.example-academy.in",
      "a@b.co",
    ]) {
      const sanitized = sanitizeFailureText(`Could not save ${address} for the batch`)

      expect(sanitized).not.toContain(address)
      expect(sanitized).toBe("Could not save <redacted-email> for the batch")
    }
  })

  it("redacts a local part of the longest length a mail server will accept", () => {
    const address = `${"a".repeat(64)}@example.com`

    expect(sanitizeFailureText(address)).toBe("<redacted-email>")
  })

  // A run longer than RFC 5321 allows is not an address, and the bound leaves its
  // overflowing prefix in place. The address itself must still go.
  it("still removes the address when the local part is longer than any real one", () => {
    const sanitized = sanitizeFailureText(`${"a".repeat(200)}@example.com`)

    expect(sanitized).not.toContain("@")
    expect(sanitized).not.toContain("example.com")
    expect(sanitized).toContain("<redacted-email>")
  })

  // Regression guard. Anchoring the local part on a word boundary or a lookbehind
  // also removes the quadratic behaviour, but both stop the scan resuming inside a
  // run, which silently leaves the second address here in the clear.
  it("redacts both addresses when a second one begins inside the first one's run", () => {
    const sanitized = sanitizeFailureText("nested a@b.com%%%c@d.com nested")

    expect(sanitized).not.toContain("c@d.com")
    expect(sanitized).toBe("nested <redacted-email><redacted-email> nested")
  })

  it("leaves text that only looks like an address alone", () => {
    expect(sanitizeFailureText("at load (app/page.tsx:1:2)")).toBe("at load (app/page.tsx:1:2)")
    expect(sanitizeFailureText("portal.smbaacademy.in")).toBe("portal.smbaacademy.in")
  })
})

// A generous budget: the point is to fail loudly if quadratic behaviour returns,
// not to measure throughput. The unbounded rule took ~700ms on the 32KB case and
// ~4ms on the 2KB one, so a single budget for both only holds if the rule is
// linear, while leaving linear behaviour more than an order of magnitude spare.
const PATHOLOGICAL_BUDGET_MS = 150

function millisecondsToSanitize(input: string) {
  // Best of three. A single sample on a shared CI runner can be preempted.
  let fastest = Number.POSITIVE_INFINITY

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const startedAt = performance.now()
    sanitizeFailureText(input)
    fastest = Math.min(fastest, performance.now() - startedAt)
  }

  return fastest
}

describe("redaction cost on pathological input", () => {
  it("sanitizes a body of the largest size the client error endpoint accepts", () => {
    expect(millisecondsToSanitize("%".repeat(2_048))).toBeLessThan(PATHOLOGICAL_BUDGET_MS)
  })

  // The endpoint's 2KB cap is not what makes this safe, so the guarantee is
  // asserted well past it. This is the input CodeQL named.
  it("stays cheap far beyond that cap, where a quadratic rule could not", () => {
    expect(millisecondsToSanitize("%".repeat(32_768))).toBeLessThan(PATHOLOGICAL_BUDGET_MS)
  })

  // The email rule was the only quadratic one, but a sibling written the same way
  // would be the next defect, so each rule's worst shape is held to the same bar.
  it("stays cheap on the worst input shape for every other rule", () => {
    for (const input of [
      ".".repeat(32_768),
      `a@${".".repeat(32_766)}`,
      "a.".repeat(16_384),
      "a@".repeat(16_384),
      `${"A".repeat(32_767)}a`,
      `password${" ".repeat(32_760)}`,
      `token_${"a".repeat(32_762)}`,
      "SMBA-HC-".repeat(4_096),
      "1".repeat(32_768),
    ]) {
      expect(millisecondsToSanitize(input)).toBeLessThan(PATHOLOGICAL_BUDGET_MS)
    }
  })
})

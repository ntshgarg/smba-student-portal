import { describe, expect, it } from "vitest"

import {
  sanitizeFailureText,
  sanitizeFailureUrl,
} from "./e2e/support/failure-evidence"

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

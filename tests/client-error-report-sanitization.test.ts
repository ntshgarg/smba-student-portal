import { describe, expect, it } from "vitest"

import {
  CLIENT_ERROR_BOUNDARIES,
  clientErrorSignature,
  describeReportedError,
  normalizeBoundary,
  normalizeErrorDigest,
  normalizeErrorName,
  normalizeReportType,
  parseClientErrorReport,
  redactReportSummary,
  toRoutePattern,
} from "@/lib/telemetry/error-report"
import { sanitizeFailureText } from "@/lib/telemetry/redaction"

const PLAYER_UUID = "9f1c4a2e-7b3d-4f58-9a10-2c6e5d8b7a41"

describe("toRoutePattern", () => {
  it("keeps a static SMBA route as written", () => {
    expect(toRoutePattern("/coach/financials")).toBe("/coach/financials")
    expect(toRoutePattern("/player/financials")).toBe("/player/financials")
    expect(toRoutePattern("/account/recovery-email/setup")).toBe("/account/recovery-email/setup")
    expect(toRoutePattern("/")).toBe("/")
  })

  it("masks a player id, a report id and an Academy ID out of the path", () => {
    expect(toRoutePattern(`/reports/${PLAYER_UUID}`)).toBe("/reports/:id")
    expect(toRoutePattern("/coach/members/SMBA-PL-0004")).toBe("/coach/members/:id")
    expect(toRoutePattern(`/coach/financials/${PLAYER_UUID}/ledger`))
      .toBe("/coach/financials/:id/ledger")
  })

  it("drops the query string and the fragment rather than masking inside them", () => {
    expect(toRoutePattern("/coach/members?academyId=SMBA-PL-0004&token=abc"))
      .toBe("/coach/members")
    expect(toRoutePattern("/login#recovery-code")).toBe("/login")
  })

  it("refuses a resolved URL, so no origin can reach the table", () => {
    expect(toRoutePattern("https://portal.smbaacademy.in/coach/members/SMBA-PL-0004"))
      .toBe("/unknown")
  })

  it("masks an encoded segment instead of decoding it", () => {
    expect(toRoutePattern("/coach/members/Aarav%20Gupta")).toBe("/coach/members/:id")
  })

  it("is a no-op when applied to its own output, so the server can mask again", () => {
    for (const pathname of [
      "/",
      "/coach/financials",
      `/reports/${PLAYER_UUID}`,
      "/a/b/c/d/e/f/g/h",
      "https://example.test/x",
    ]) {
      const once = toRoutePattern(pathname)
      expect(toRoutePattern(once)).toBe(once)
    }
  })

  it("bounds the number of segments it will record", () => {
    expect(toRoutePattern("/a/b/c/d/e/f/g/h")).toBe("/a/b/c/d/e/f/:rest")
  })

  it("falls back for anything that is not a pathname", () => {
    expect(toRoutePattern(undefined)).toBe("/unknown")
    expect(toRoutePattern(null)).toBe("/unknown")
    expect(toRoutePattern(42)).toBe("/unknown")
    expect(toRoutePattern({ pathname: "/coach" })).toBe("/unknown")
    expect(toRoutePattern("coach/financials")).toBe("/unknown")
  })
})

describe("normalizeErrorName", () => {
  it("keeps the error classes an operator triages by", () => {
    expect(normalizeErrorName("TypeError")).toBe("TypeError")
    expect(normalizeErrorName("ChunkLoadError")).toBe("ChunkLoadError")
    expect(normalizeErrorName("SaveTimeoutError")).toBe("SaveTimeoutError")
  })

  it("collapses any unrecognised name so the column cannot hold free text", () => {
    expect(normalizeErrorName("PlayerAaravGuptaError")).toBe("Error")
    expect(normalizeErrorName("Aarav Gupta could not be saved")).toBe("Error")
    expect(normalizeErrorName("typeerror")).toBe("Error")
    expect(normalizeErrorName(undefined)).toBe("Error")
    expect(normalizeErrorName({ name: "TypeError" })).toBe("Error")
  })
})

describe("normalizeErrorDigest", () => {
  it("accepts the opaque digests Next.js produces", () => {
    expect(normalizeErrorDigest("1737209896")).toBe("1737209896")
    expect(normalizeErrorDigest("3F2A9C")).toBe("3f2a9c")
    expect(normalizeErrorDigest("  deadbeef  ")).toBe("deadbeef")
  })

  it("rejects a framework control digest, which carries a resolved URL", () => {
    expect(normalizeErrorDigest("NEXT_REDIRECT;push;/coach/members/SMBA-PL-0004;307;")).toBeNull()
    expect(normalizeErrorDigest("NEXT_NOT_FOUND")).toBeNull()
    expect(normalizeErrorDigest("NEXT_HTTP_ERROR_FALLBACK;404")).toBeNull()
  })

  it("rejects anything that is not the opaque shape", () => {
    expect(normalizeErrorDigest("")).toBeNull()
    expect(normalizeErrorDigest("coach@example.com")).toBeNull()
    expect(normalizeErrorDigest("z".repeat(10))).toBeNull()
    expect(normalizeErrorDigest("a".repeat(65))).toBeNull()
    expect(normalizeErrorDigest(1_737_209_896)).toBeNull()
    expect(normalizeErrorDigest(null)).toBeNull()
  })
})

describe("normalizeBoundary and normalizeReportType", () => {
  it("accepts every wired boundary and nothing else", () => {
    for (const boundary of CLIENT_ERROR_BOUNDARIES) {
      expect(normalizeBoundary(boundary)).toBe(boundary)
    }
    expect(normalizeBoundary("coach_financials_v2")).toBeNull()
    expect(normalizeBoundary("")).toBeNull()
    expect(normalizeBoundary(undefined)).toBeNull()
  })

  it("accepts only the two report types", () => {
    expect(normalizeReportType("client_error")).toBe("client_error")
    expect(normalizeReportType("unhandled_rejection")).toBe("unhandled_rejection")
    expect(normalizeReportType("audit")).toBeNull()
    expect(normalizeReportType(7)).toBeNull()
  })
})

describe("redactReportSummary", () => {
  it("applies the shared failure-evidence redaction rules", () => {
    const source = "email=coach@example.com password=hunter2 pin:246810 token=abc123 SMBA-HC-0001"

    expect(redactReportSummary(source)).toBe(sanitizeFailureText(source))
    expect(redactReportSummary(source)).not.toContain("coach@example.com")
    expect(redactReportSummary(source)).not.toContain("hunter2")
    expect(redactReportSummary(source)).not.toContain("246810")
    expect(redactReportSummary(source)).not.toContain("SMBA-HC-0001")
  })

  it("collapses whitespace so a stack-shaped message stays one line", () => {
    expect(redactReportSummary("Error: broke\n    at load (chunk.js:1:2)"))
      .toBe("Error: broke at load (chunk.js:1:2)")
  })

  it("bounds the length of the text that feeds the fingerprint", () => {
    expect(redactReportSummary("x".repeat(5_000))).toHaveLength(300)
  })

  it("returns an empty summary for a non-string", () => {
    expect(redactReportSummary(undefined)).toBe("")
    expect(redactReportSummary({ message: "broke" })).toBe("")
  })
})

describe("describeReportedError", () => {
  it("reads the name, digest and redacted message from an Error", () => {
    const error = Object.assign(
      new TypeError("Cannot read properties of undefined (reading 'batch')"),
      { digest: "1737209896" },
    )

    expect(describeReportedError(error)).toEqual({
      digest: "1737209896",
      errorName: "TypeError",
      summary: "TypeError: Cannot read properties of undefined (reading 'batch')",
    })
  })

  it("redacts the summary of a message that names a person's contact details", () => {
    const description = describeReportedError(
      new Error("Could not save aarav.guardian@example.com for SMBA-PL-0004"),
    )

    expect(description.summary).not.toContain("aarav.guardian@example.com")
    expect(description.summary).not.toContain("SMBA-PL-0004")
    expect(description.summary).toContain("<redacted-email>")
    expect(description.summary).toContain("<redacted-academy-id>")
  })

  it("keeps a custom error class distinguishable in the summary while storing Error", () => {
    const first = describeReportedError(Object.assign(new Error("boom"), { name: "FeeLockError" }))
    const second = describeReportedError(Object.assign(new Error("boom"), { name: "BatchLockError" }))

    expect(first.errorName).toBe("Error")
    expect(second.errorName).toBe("Error")
    expect(first.summary).not.toBe(second.summary)
  })

  it("survives a thrown value whose getters throw", () => {
    const hostile = {
      get digest(): string { throw new Error("no digest for you") },
      get message(): string { throw new Error("no message for you") },
      get name(): string { throw new Error("no name for you") },
    }

    expect(() => describeReportedError(hostile)).not.toThrow()
    expect(describeReportedError(hostile)).toEqual({
      digest: null,
      errorName: "Error",
      summary: "Error:",
    })
  })

  it("handles thrown values that are not errors at all", () => {
    expect(describeReportedError("just a string")).toEqual({
      digest: null,
      errorName: "Error",
      summary: "Error: just a string",
    })
    expect(describeReportedError(undefined)).toEqual({
      digest: null,
      errorName: "Error",
      summary: "Error:",
    })
    expect(describeReportedError(null).errorName).toBe("Error")
  })
})

describe("parseClientErrorReport", () => {
  it("normalizes an untrusted body rather than trusting the client's own masking", () => {
    expect(parseClientErrorReport({
      boundary: "coach_financials",
      digest: "NEXT_REDIRECT;push;/coach/members/SMBA-PL-0004;307;",
      errorName: "AaravGuptaError",
      eventType: "client_error",
      extraField: "ignored",
      routePath: `/coach/financials/${PLAYER_UUID}?academyId=SMBA-PL-0004`,
      summary: "Could not save coach@example.com",
    })).toEqual({
      boundary: "coach_financials",
      digest: null,
      errorName: "Error",
      eventType: "client_error",
      routePath: "/coach/financials/:id",
      summary: "Could not save <redacted-email>",
    })
  })

  it("rejects a body without a recognised boundary or report type", () => {
    expect(parseClientErrorReport({ boundary: "coach", eventType: "audit" })).toBeNull()
    expect(parseClientErrorReport({ boundary: "elsewhere", eventType: "client_error" })).toBeNull()
    expect(parseClientErrorReport({})).toBeNull()
    expect(parseClientErrorReport(null)).toBeNull()
    expect(parseClientErrorReport("client_error")).toBeNull()
    expect(parseClientErrorReport([])).toBeNull()
  })

  it("fills the remaining fields when a report arrives with only the two required ones", () => {
    expect(parseClientErrorReport({ boundary: "window", eventType: "unhandled_rejection" })).toEqual({
      boundary: "window",
      digest: null,
      errorName: "Error",
      eventType: "unhandled_rejection",
      routePath: "/unknown",
      summary: "",
    })
  })
})

describe("clientErrorSignature", () => {
  const base = {
    boundary: "coach" as const,
    digest: null,
    errorName: "TypeError",
    eventType: "client_error" as const,
    routePath: "/coach/financials",
    summary: "TypeError: batch is undefined",
  }

  it("separates two different faults on the same route", () => {
    expect(clientErrorSignature(base)).not.toBe(clientErrorSignature({
      ...base,
      summary: "TypeError: ledger is undefined",
    }))
  })

  it("separates the same fault seen from different boundaries and routes", () => {
    expect(clientErrorSignature(base)).not.toBe(clientErrorSignature({ ...base, boundary: "root" }))
    expect(clientErrorSignature(base)).not.toBe(clientErrorSignature({ ...base, routePath: "/coach" }))
  })

  it("groups repeat occurrences of one fault", () => {
    expect(clientErrorSignature(base)).toBe(clientErrorSignature({ ...base }))
  })

  it("carries no text beyond the already redacted fields", () => {
    const signature = clientErrorSignature({
      ...base,
      summary: redactReportSummary("Could not save aarav.guardian@example.com"),
    })

    expect(signature).not.toContain("aarav.guardian@example.com")
  })
})

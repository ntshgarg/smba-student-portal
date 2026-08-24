import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const mocks = vi.hoisted(() => ({
  getRawAuthSession: vi.fn(),
  recordClientErrorReport: vi.fn(),
  requestSecurityContext: vi.fn(),
}))

vi.mock("@/lib/auth/session", () => ({ getRawAuthSession: mocks.getRawAuthSession }))
vi.mock("@/lib/auth/security-context", () => ({
  requestSecurityContext: mocks.requestSecurityContext,
}))
vi.mock("@/lib/telemetry/record-client-error", () => ({
  recordClientErrorReport: mocks.recordClientErrorReport,
}))

import { POST } from "@/app/api/client-errors/route"
import { MAX_CLIENT_ERROR_REPORT_BYTES } from "@/lib/telemetry/error-report"

const ENDPOINT = "https://portal.smbaacademy.in/api/client-errors"

const validReport = {
  boundary: "coach_financials",
  digest: "1737209896",
  errorName: "TypeError",
  eventType: "client_error",
  routePath: "/coach/financials/:id",
  summary: "TypeError: ledger is undefined",
}

// The rate limiter keeps per-caller state for the lifetime of the module, so
// every case claims its own caller.
function report(body: unknown, headers: Record<string, string> = {}) {
  return new Request(ENDPOINT, {
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
    method: "POST",
  })
}

beforeEach(() => {
  mocks.getRawAuthSession.mockReset().mockResolvedValue({ user: { id: "account-coach" } })
  mocks.recordClientErrorReport.mockReset().mockReturnValue("recorded")
  mocks.requestSecurityContext.mockReset()
    .mockReturnValue({ ipHash: `caller-${Math.random()}`, userAgent: null })
})

describe("client error report endpoint", () => {
  it("stores a normalized report for a signed-in visitor and answers without a body", async () => {
    const response = await POST(report(validReport))

    expect(response.status).toBe(204)
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(await response.text()).toBe("")
    expect(mocks.recordClientErrorReport).toHaveBeenCalledTimes(1)
    expect(mocks.recordClientErrorReport).toHaveBeenCalledWith({
      accountId: "account-coach",
      report: {
        boundary: "coach_financials",
        digest: "1737209896",
        errorName: "TypeError",
        eventType: "client_error",
        routePath: "/coach/financials/:id",
        summary: "TypeError: ledger is undefined",
      },
    })
  })

  it("accepts an anonymous report, so a break on /login is still visible", async () => {
    mocks.getRawAuthSession.mockResolvedValue(null)

    const response = await POST(report({
      ...validReport,
      boundary: "window",
      eventType: "unhandled_rejection",
      routePath: "/login",
    }))

    expect(response.status).toBe(204)
    expect(mocks.recordClientErrorReport).toHaveBeenCalledWith({
      accountId: null,
      report: expect.objectContaining({ boundary: "window", routePath: "/login" }),
    })
  })

  it("re-masks a route and re-redacts a summary the caller did not sanitize", async () => {
    await POST(report({
      ...validReport,
      digest: "NEXT_REDIRECT;push;/coach/members/SMBA-PL-0004;307;",
      errorName: "AaravGuptaError",
      routePath: "/coach/members/SMBA-PL-0004?token=abc",
      summary: "Could not save aarav.guardian@example.com",
    }))

    expect(mocks.recordClientErrorReport).toHaveBeenCalledWith({
      accountId: "account-coach",
      report: {
        boundary: "coach_financials",
        digest: null,
        errorName: "Error",
        eventType: "client_error",
        routePath: "/coach/members/:id",
        summary: "Could not save <redacted-email>",
      },
    })
  })

  it("refuses a cross-site submission", async () => {
    const response = await POST(report(validReport, { "sec-fetch-site": "cross-site" }))

    expect(response.status).toBe(403)
    expect(mocks.recordClientErrorReport).not.toHaveBeenCalled()
  })

  it("allows a same-origin submission and one with no fetch metadata at all", async () => {
    expect((await POST(report(validReport, { "sec-fetch-site": "same-origin" }))).status).toBe(204)
    expect((await POST(report(validReport))).status).toBe(204)
    expect(mocks.recordClientErrorReport).toHaveBeenCalledTimes(2)
  })

  it("rejects a body larger than the cap", async () => {
    const oversized = await POST(report({
      ...validReport,
      summary: "x".repeat(MAX_CLIENT_ERROR_REPORT_BYTES),
    }))

    expect(oversized.status).toBe(413)
    expect(mocks.recordClientErrorReport).not.toHaveBeenCalled()
  })

  it("rejects an oversized declaration without reading the body", async () => {
    const read = vi.fn()
    const declaredOversize = {
      headers: new Headers({
        "content-length": String(MAX_CLIENT_ERROR_REPORT_BYTES + 1),
      }),
      text: read,
    } as unknown as Request

    expect((await POST(declaredOversize)).status).toBe(413)
    expect(read).not.toHaveBeenCalled()
    expect(mocks.recordClientErrorReport).not.toHaveBeenCalled()
  })

  it("accepts and drops a malformed or unrecognised body without explaining why", async () => {
    for (const body of ["not json at all", "", "[]", "null", JSON.stringify({ boundary: "coach" })]) {
      const response = await POST(report(body))
      expect(response.status).toBe(204)
      expect(await response.text()).toBe("")
    }

    expect(mocks.recordClientErrorReport).not.toHaveBeenCalled()
  })

  it("stops a caller that floods the endpoint", async () => {
    mocks.requestSecurityContext.mockReturnValue({ ipHash: "flooding-caller", userAgent: null })

    const statuses: number[] = []
    for (let attempt = 0; attempt < 25; attempt += 1) {
      statuses.push((await POST(report({ ...validReport, summary: `fault ${attempt}` }))).status)
    }

    expect(statuses.filter((status) => status === 204)).toHaveLength(20)
    expect(statuses.filter((status) => status === 429)).toHaveLength(5)
    expect(mocks.recordClientErrorReport).toHaveBeenCalledTimes(20)
  })

  it("never answers a failed write with a status the browser might retry", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    mocks.recordClientErrorReport.mockImplementation(() => {
      throw new Error("database unavailable")
    })

    expect((await POST(report(validReport))).status).toBe(204)
    // F-18: this is the portal's only client-fault channel. Answering 204 hides
    // the failure from the browser on purpose, so the log is the one place left
    // that can say the channel itself is down.
    expect(String(consoleError.mock.calls[0]?.[1]?.cause)).toContain("database unavailable")

    consoleError.mockRestore()
  })

  it("records the report even when the session lookup fails", async () => {
    mocks.getRawAuthSession.mockRejectedValue(new Error("no request scope"))

    expect((await POST(report(validReport))).status).toBe(204)
    expect(mocks.recordClientErrorReport).toHaveBeenCalledWith({
      accountId: null,
      report: expect.objectContaining({ boundary: "coach_financials" }),
    })
  })
})

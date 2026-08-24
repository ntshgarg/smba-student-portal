import { describe, expect, it, vi } from "vitest"

import {
  authorizeDownload,
  downloadFailureResponse,
  drainCursorPages,
  safeFileName,
} from "@/lib/http/download-route"
import { describeFailureCause } from "@/lib/telemetry/failure-cause"

// `authorizeDownload` is the access-control preamble for the entire finance and
// report download surface: seven routes that each used to carry their own copy
// now share this one. A shared gate that admits anyone a single one of those
// routes would have refused is privilege escalation on financial downloads, so
// every refusal it can make is pinned here instead of being left to the route
// suites, which only cover the combinations their own route happens to hit.
describe("the shared download authorisation preamble", () => {
  const coach = { role: "coach", subjectId: "coach-1" }

  it("refuses a caller with no session before consulting the route's gate", () => {
    const check = vi.fn()

    const access = authorizeDownload(null, "coach", {
      check,
      deniedMessage: "Head coach access is required.",
    })

    expect(access.allowed).toBe(false)
    expect(check).not.toHaveBeenCalled()
  })

  it("refuses every role other than the one the route asked for", () => {
    for (const role of ["player", "platform_admin", "", "COACH"]) {
      const access = authorizeDownload({ ...coach, role }, "coach")
      expect(access.allowed, `role ${role} must not reach a coach download`).toBe(false)
    }

    // The player report route is the mirror image: a coach is not a player.
    expect(authorizeDownload({ ...coach, role: "coach" }, "player").allowed).toBe(false)
  })

  it("refuses with the route's own message when the route's gate throws", async () => {
    const access = authorizeDownload(coach, "coach", {
      check: () => {
        throw new Error("Head coach access is required.")
      },
      deniedMessage: "Head coach access is required.",
    })

    expect(access.allowed).toBe(false)
    if (access.allowed) return
    expect(access.rejection.status).toBe(403)
    expect(await access.rejection.text()).toBe("Head coach access is required.")
  })

  it("answers every refusal with the private download headers", () => {
    const refusals = [
      authorizeDownload(null, "coach"),
      authorizeDownload({ ...coach, role: "player" }, "coach"),
      authorizeDownload(coach, "coach", {
        check: () => {
          throw new Error("denied")
        },
        deniedMessage: "Head coach access is required.",
      }),
    ]

    for (const access of refusals) {
      expect(access.allowed).toBe(false)
      if (access.allowed) continue
      expect(access.rejection.headers.get("cache-control")).toBe("private, no-store")
      expect(access.rejection.headers.get("x-content-type-options")).toBe("nosniff")
      expect([401, 403]).toContain(access.rejection.status)
    }
  })

  it("admits the caller only once the role matches and the gate returns", () => {
    const check = vi.fn()

    const access = authorizeDownload(coach, "coach", {
      check,
      deniedMessage: "Head coach access is required.",
    })

    expect(access.allowed).toBe(true)
    if (!access.allowed) return
    expect(access.identity).toBe(coach)
    expect(check).toHaveBeenCalledWith(coach)
  })

  // A route with no rule beyond its role passes no gate. That is the player
  // report route, whose ownership check is the repository read that follows.
  it("admits a matching role when the route passes no gate", () => {
    expect(authorizeDownload({ role: "player" }, "player").allowed).toBe(true)
  })
})

describe("the shared attachment filename", () => {
  it("reduces a display name to something a header can carry", () => {
    expect(safeFileName("Aarav / Bhat\r\nInjected.pdf", "fallback"))
      .toBe("Aarav-Bhat-Injected-pdf")
  })

  it("falls back when the name has no characters left to keep", () => {
    expect(safeFileName("///", "SMBA-Payment-Receipt")).toBe("SMBA-Payment-Receipt")
  })

  it("keeps the letters of an accented name instead of losing them", () => {
    expect(safeFileName("José Ramírez", "fallback")).toBe("Jose-Ramirez")
  })
})

type CursorPage = { items: number[]; nextCursor: string | null }

describe("the shared cursor drain", () => {
  it("yields every page in order and stops on a null cursor", () => {
    const pages = new Map<string, CursorPage>([
      ["a", { items: [3, 4], nextCursor: "b" }],
      ["b", { items: [5], nextCursor: null }],
    ])
    const first: CursorPage = { items: [1, 2], nextCursor: "a" }

    const drained = [...drainCursorPages(
      first,
      (page) => page.items,
      (cursor) => pages.get(cursor) ?? { items: [], nextCursor: null },
    )]

    expect(drained).toEqual([1, 2, 3, 4, 5])
  })

  // An export that streams forever is worse than one that ends short.
  it("stops rather than looping when a service repeats a cursor", () => {
    const first: CursorPage = { items: [1], nextCursor: "same" }

    const drained = [...drainCursorPages(
      first,
      (page) => page.items,
      () => ({ items: [2], nextCursor: "same" }),
    )]

    expect(drained).toEqual([1, 2])
  })
})

// IQ-3: every 500 on this surface used to log a static string and drop the
// caught error, so the log said a download failed and nothing about why. The
// cause is now logged, which is only safe because it goes through the redaction
// rules on the way. Both halves are asserted: the diagnosis survives, the
// secrets do not.
describe("the logged cause of a download failure", () => {
  it("keeps what identifies the fault and redacts what identifies a person", () => {
    const error = new Error(
      "SQLITE_BUSY: database is locked while reading coach@example.com for "
      + "SMBA-HC-0001 from /api/finance?session_token=nkkfwexhpqzrmdlvbtcu pin: 246810",
    )

    const cause = describeFailureCause(error)

    expect(cause).toContain("SQLITE_BUSY: database is locked")
    expect(cause).toContain("<redacted-email>")
    expect(cause).toContain("<redacted-academy-id>")
    expect(cause).toContain("session_token=<redacted>")

    for (const secret of [
      "coach@example.com",
      "SMBA-HC-0001",
      "nkkfwexhpqzrmdlvbtcu",
      "246810",
    ]) {
      expect(cause, `${secret} must not reach the log`).not.toContain(secret)
    }
  })

  it("stays on one line and within a bounded length", () => {
    const error = new Error("failed")
    error.stack = `Error: failed\n${"    at frame (app/page.tsx:1:2)\n".repeat(200)}`

    const cause = describeFailureCause(error)

    expect(cause).not.toContain("\n")
    expect(cause.length).toBeLessThanOrEqual(1_000)
  })

  it("describes a thrown value that is not an error", () => {
    expect(describeFailureCause("plain string failure")).toBe("plain string failure")
    expect(describeFailureCause(undefined)).toBe("undefined")
  })

  // Losing the cause is acceptable; losing the log line is not.
  it("survives a thrown value whose own conversion throws", () => {
    const hostile = {
      toString() {
        throw new Error("nope")
      },
    }

    expect(describeFailureCause(hostile)).toBe("unreadable thrown value")
  })

  it("logs the cause alongside the route's context and answers a private 500", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)

    const response = downloadFailureResponse(new Error("pdfkit exploded"), {
      context: { paymentId: "payment-1" },
      label: "Financial receipt PDF generation failed.",
      message: "Unable to generate the financial record.",
    })

    expect(consoleError).toHaveBeenCalledWith(
      "Financial receipt PDF generation failed.",
      expect.objectContaining({ paymentId: "payment-1" }),
    )
    expect(String(consoleError.mock.calls[0]?.[1]?.cause)).toContain("pdfkit exploded")
    expect(response.status).toBe(500)
    expect(await response.text()).toBe("Unable to generate the financial record.")
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")

    consoleError.mockRestore()
  })
})

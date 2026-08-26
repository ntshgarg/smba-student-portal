import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const databaseRun = vi.hoisted(() => vi.fn())

vi.mock("@/lib/db/client", () => ({
  initializeDatabase: () => ({ run: databaseRun }),
}))

import { GET } from "@/app/api/health/route"

describe("public health endpoint", () => {
  beforeEach(() => {
    databaseRun.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("returns a cache-resistant success without exposing database details", async () => {
    databaseRun.mockReturnValue({ rowsAffected: 0 })

    const response = await GET()

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(await response.json()).toEqual({ status: "ok" })
    expect(databaseRun).toHaveBeenCalledOnce()
  })

  it("fails closed when the database cannot be reached", async () => {
    databaseRun.mockImplementation(() => {
      throw new Error("connection unavailable")
    })
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)

    const response = await GET()

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ status: "unavailable" })
    expect(consoleError).toHaveBeenCalledWith(
      "Health check database probe failed.",
      { cause: expect.stringContaining("connection unavailable") },
    )
    consoleError.mockRestore()
  })

  it("echoes the day the accessibility gate pinned this server to", async () => {
    // The only way the gate can tell a pinned server from a wall-clock one:
    // SMBA_ACCESSIBILITY_CLOCK is read here, in the Next process, while the
    // Playwright runner attaches to a server it did not start. The success case
    // above is the other half -- unpinned, the payload is exactly {status:"ok"},
    // so a deployment's health response is unchanged and an absent field is
    // proof of a wall-clock server rather than of an older build.
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-health-clock-"))
    try {
      databaseRun.mockReturnValue({ rowsAffected: 0 })
      vi.stubEnv("VERCEL", "")
      vi.stubEnv("TMPDIR", directory)
      vi.stubEnv("DB_FILE_NAME", path.join(directory, "smba-accessibility-stress.db"))
      vi.stubEnv("SMBA_ACCESSIBILITY_PROFILE", "stress")
      vi.stubEnv("SMBA_ACCESSIBILITY_CLOCK", "2026-08-17T09:30:00+05:30")

      expect(await (await GET()).json()).toEqual({ fixtureClock: "2026-08-17", status: "ok" })
    } finally {
      fs.rmSync(directory, { force: true, recursive: true })
    }
  })
})

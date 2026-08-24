import { beforeEach, describe, expect, it, vi } from "vitest"

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
})

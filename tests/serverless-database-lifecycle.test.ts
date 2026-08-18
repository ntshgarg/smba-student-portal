import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const remoteState = vi.hoisted(() => ({
  connections: [] as Array<{ closed: boolean; open: boolean }>,
}))

vi.mock("libsql", () => {
  class FakeRemoteDatabase {
    closed = false
    open = true

    constructor() {
      remoteState.connections.push(this)
    }

    close() {
      this.closed = true
      this.open = false
      return this
    }

    pragma() {
      return []
    }
  }

  return { default: FakeRemoteDatabase }
})

describe("serverless database connection lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-19T00:00:00.000Z"))
    remoteState.connections.length = 0
    process.env.TURSO_DATABASE_URL = "libsql://test.turso.io"
    process.env.TURSO_AUTH_TOKEN = "test-token"
    process.env.VERCEL = "1"
  })

  afterEach(async () => {
    const { closeDatabaseConnection } = await import("@/lib/db/client")
    closeDatabaseConnection()
    delete process.env.TURSO_DATABASE_URL
    delete process.env.TURSO_AUTH_TOKEN
    delete process.env.VERCEL
    vi.useRealTimers()
  })

  it("replaces a remote connection after a serverless worker resumes from idle", async () => {
    const { initializeDatabase } = await import("@/lib/db/client")

    const initial = initializeDatabase()
    vi.advanceTimersByTime(29_000)
    expect(initializeDatabase()).toBe(initial)
    expect(remoteState.connections).toHaveLength(1)

    vi.advanceTimersByTime(30_001)
    const resumed = initializeDatabase()

    expect(resumed).not.toBe(initial)
    expect(remoteState.connections).toHaveLength(2)
    expect(remoteState.connections[0]).toMatchObject({ closed: true, open: false })
  })
})

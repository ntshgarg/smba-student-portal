import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-auth-secret-"))
const databasePath = path.join(temporaryDirectory, "auth.db")

// authSecret() runs while the module body builds the shared auth runtime, so the
// gate can only be observed by importing that module again under a new environment.
async function importAuthRuntime() {
  vi.resetModules()
  return import("@/lib/auth/better-auth")
}

function stubSelfHostedProduction() {
  vi.stubEnv("DB_FILE_NAME", databasePath)
  vi.stubEnv("BETTER_AUTH_SECRET", "")
  vi.stubEnv("NEXT_PUBLIC_SMBA_SITE_ORIGIN", "https://portal.example.test")
  vi.stubEnv("NODE_ENV", "production")
  vi.stubEnv("VERCEL", "")
}

beforeAll(async () => {
  vi.stubEnv("DB_FILE_NAME", databasePath)
  const { prepareDatabase } = await import("@/lib/db/setup")
  prepareDatabase({ emptyAcademy: true, seed: true })
  vi.unstubAllEnvs()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

afterAll(() => {
  fs.rmSync(temporaryDirectory, { force: true, recursive: true })
})

describe("BETTER_AUTH_SECRET policy", () => {
  it("refuses to serve a self-hosted production boot with the committed local secret", async () => {
    stubSelfHostedProduction()
    await expect(importAuthRuntime()).rejects.toThrow(
      /BETTER_AUTH_SECRET is required in production/,
    )
  })

  it("keeps npm run build and fixture:start:* working through the explicit opt-in", async () => {
    stubSelfHostedProduction()
    vi.stubEnv("SMBA_ALLOW_LOCAL_AUTH_SECRET", "true")
    await expect(importAuthRuntime()).resolves.toHaveProperty("auth")
  })

  it("ignores the opt-in on Vercel, where a real secret is always required", async () => {
    stubSelfHostedProduction()
    vi.stubEnv("SMBA_ALLOW_LOCAL_AUTH_SECRET", "true")
    vi.stubEnv("VERCEL", "1")
    await expect(importAuthRuntime()).rejects.toThrow(
      /BETTER_AUTH_SECRET is required for a Vercel deployment/,
    )
  })
})

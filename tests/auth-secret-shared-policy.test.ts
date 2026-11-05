import { createHmac } from "node:crypto"

import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

const GOOD = "a-real-secret-that-is-comfortably-over-32-chars"

async function load() {
  vi.resetModules()
  const context = await import("@/lib/auth/security-context")
  const preview = await import("@/lib/auth/admin-preview")
  return { ...context, ...preview }
}

describe("every HMAC key comes from one policy", () => {
  it("lets a module that merely imports the secret-keyed code load without the secret", async () => {
    vi.stubEnv("VERCEL", "1")
    vi.stubEnv("BETTER_AUTH_SECRET", "")
    // Database preparation during a Vercel build imports these and signs nothing.
    await expect(load()).resolves.toBeTruthy()
  })

  it("refuses to hash with a published value on Vercel", async () => {
    vi.stubEnv("VERCEL", "1")
    vi.stubEnv("BETTER_AUTH_SECRET", "")
    const mod = await load()
    expect(() => mod.authSubjectHash("SMBA-HC-0001")).toThrow(/BETTER_AUTH_SECRET is required/u)
    expect(() => mod.unknownIpHash()).toThrow(/BETTER_AUTH_SECRET is required/u)
    expect(() => mod.createAdminPreviewToken({ actorAccountId: "a", targetAccountId: "b" }))
      .toThrow(/BETTER_AUTH_SECRET is required/u)
  })

  it("refuses a self-hosted production build unless it is declared a disposable fixture", async () => {
    vi.stubEnv("VERCEL", "")
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("BETTER_AUTH_SECRET", "")
    const mod = await load()
    expect(() => mod.authSubjectHash("SMBA-HC-0001")).toThrow(/BETTER_AUTH_SECRET is required/u)

    vi.stubEnv("SMBA_ALLOW_LOCAL_AUTH_SECRET", "true")
    expect(() => mod.authSubjectHash("SMBA-HC-0001")).not.toThrow()
  })

  it("refuses a configured secret that is too short", async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "too-short")
    const mod = await load()
    expect(() => mod.authSubjectHash("SMBA-HC-0001")).toThrow(/at least 32 characters/u)
  })

  it("keys off the configured secret when there is one", async () => {
    vi.stubEnv("VERCEL", "1")
    vi.stubEnv("BETTER_AUTH_SECRET", GOOD)
    const mod = await load()
    expect(mod.authSubjectHash("SMBA-HC-0001")).toBe(
      createHmac("sha256", GOOD).update("subject:SMBA-HC-0001").digest("hex"),
    )
  })

  it("keeps the exact local fallback each module used, so stored fixture hashes still match", async () => {
    vi.stubEnv("VERCEL", "")
    vi.stubEnv("NODE_ENV", "test")
    vi.stubEnv("BETTER_AUTH_SECRET", "")
    const mod = await load()
    expect(mod.authSubjectHash("SMBA-HC-0001")).toBe(
      createHmac("sha256", "smba-local-only-audit-key-change-before-deployment-2026")
        .update("subject:SMBA-HC-0001").digest("hex"),
    )
  })
})

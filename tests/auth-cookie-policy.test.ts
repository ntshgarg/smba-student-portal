import { afterEach, describe, expect, it, vi } from "vitest"

import { secureAuthCookiesRequired } from "@/lib/auth/cookie-policy"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("authentication cookie policy", () => {
  it("allows an explicit plain-HTTP local production preview", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("BETTER_AUTH_SECURE_COOKIES", "false")
    vi.stubEnv("VERCEL", "")
    expect(secureAuthCookiesRequired()).toBe(false)
  })

  it("always requires secure cookies in Vercel production", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("BETTER_AUTH_SECURE_COOKIES", "false")
    vi.stubEnv("VERCEL", "1")
    vi.stubEnv("VERCEL_ENV", "production")
    expect(secureAuthCookiesRequired()).toBe(true)
  })

  it("uses non-secure cookies for ordinary local development", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("BETTER_AUTH_SECURE_COOKIES", "")
    vi.stubEnv("VERCEL", "")
    expect(secureAuthCookiesRequired()).toBe(false)
  })
})

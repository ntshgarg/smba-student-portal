import { describe, expect, it } from "vitest"

import { resolveSiteOrigin } from "@/lib/config"

const environmentVariable = "NEXT_PUBLIC_SMBA_SITE_ORIGIN"

describe("site origin configuration", () => {
  it.each(["development", "test"])(
    "uses localhost when the value is missing in %s",
    (nodeEnvironment) => {
      expect(resolveSiteOrigin(undefined, nodeEnvironment).toString())
        .toBe("http://localhost:3000/")
      expect(resolveSiteOrigin("   ", nodeEnvironment).toString())
        .toBe("http://localhost:3000/")
    },
  )

  it("allows an explicit localhost origin during development", () => {
    expect(resolveSiteOrigin("http://localhost:3000", "development").toString())
      .toBe("http://localhost:3000/")
  })

  it("requires an explicit value in production", () => {
    expect(() => resolveSiteOrigin(undefined, "production"))
      .toThrow(environmentVariable)
    expect(() => resolveSiteOrigin("   ", "production"))
      .toThrow(environmentVariable)
  })

  it("accepts and normalizes an absolute production HTTPS origin", () => {
    expect(resolveSiteOrigin("  https://academy.example.com  ", "production").toString())
      .toBe("https://academy.example.com/")
  })

  it.each([
    ["a relative value", "academy.example.com"],
    ["HTTP", "http://academy.example.com"],
    ["localhost", "https://localhost"],
    ["a localhost subdomain", "https://portal.localhost"],
    ["an IPv4 loopback address", "https://127.0.0.1"],
    ["an IPv6 loopback address", "https://[::1]"],
    ["an IPv4-mapped IPv6 loopback address", "https://[::ffff:127.0.0.1]"],
    ["credentials", "https://user:secret@academy.example.com"],
    ["a query string", "https://academy.example.com?source=portal"],
    ["an empty query string", "https://academy.example.com?"],
    ["a fragment", "https://academy.example.com#top"],
    ["an empty fragment", "https://academy.example.com#"],
    ["a path", "https://academy.example.com/academy"],
  ])("rejects %s in production", (_description, configuredValue) => {
    expect(() => resolveSiteOrigin(configuredValue, "production"))
      .toThrow(environmentVariable)
  })
})

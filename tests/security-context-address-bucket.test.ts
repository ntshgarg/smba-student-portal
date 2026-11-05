import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { addressBucket, requestSecurityContext } from "@/lib/auth/security-context"

describe("which caller an address counts as", () => {
  it("leaves an IPv4 address as itself", () => {
    expect(addressBucket("203.0.113.7")).toBe("203.0.113.7")
  })

  it("counts every address in one IPv6 /64 as the same caller", () => {
    const a = addressBucket("2001:db8:abcd:12:1111:2222:3333:4444")
    const b = addressBucket("2001:db8:abcd:12:ffff:eeee:dddd:cccc")
    const c = addressBucket("2001:0db8:abcd:0012::1")
    expect(a).toBe(b)
    expect(a).toBe(c)
    expect(a).toBe("2001:0db8:abcd:0012::/64")
  })

  it("separates different /64s", () => {
    expect(addressBucket("2001:db8:abcd:12::1")).not.toBe(addressBucket("2001:db8:abcd:13::1"))
  })

  it("expands :: wherever it sits", () => {
    expect(addressBucket("::1")).toBe("0000:0000:0000:0000::/64")
    expect(addressBucket("fe80::1")).toBe("fe80:0000:0000:0000::/64")
    expect(addressBucket("2001:db8::")).toBe("2001:0db8:0000:0000::/64")
    expect(addressBucket("1:2:3:4:5:6:7:8")).toBe("0001:0002:0003:0004::/64")
  })

  it("ignores a zone id", () => {
    expect(addressBucket("fe80::1%eth0")).toBe(addressBucket("fe80::2"))
  })

  it("unwraps an IPv4-mapped address so both spellings share a bucket", () => {
    expect(addressBucket("::ffff:203.0.113.7")).toBe("203.0.113.7")
    expect(addressBucket("::ffff:cb00:7107")).toBe("203.0.113.7")
  })

  it("unwraps a NAT64 address, so clients behind it are not one shared bucket", () => {
    expect(addressBucket("64:ff9b::1.2.3.4")).toBe("1.2.3.4")
    expect(addressBucket("64:ff9b::9.9.9.9")).toBe("9.9.9.9")
  })
})

describe("the hash a request is counted under", () => {
  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = "test-only-better-auth-secret-with-32-characters"
    process.env.SMBA_FORWARDED_IP_HEADER = "x-forwarded-for"
  })
  afterEach(() => {
    delete process.env.BETTER_AUTH_SECRET
    delete process.env.SMBA_FORWARDED_IP_HEADER
  })

  const hashFor = (address: string) =>
    requestSecurityContext(new Headers({ "x-forwarded-for": address })).ipHash

  it("does not let a client mint a new bucket per request by rotating inside its /64", () => {
    const hashes = new Set<string>()
    for (let index = 0; index < 50; index += 1) {
      hashes.add(hashFor(`2001:db8:abcd:12:${index.toString(16)}::${index.toString(16)}`))
    }
    expect(hashes.size).toBe(1)
  })

  it("still tells different subscribers apart", () => {
    expect(hashFor("2001:db8:abcd:12::1")).not.toBe(hashFor("2001:db8:abcd:99::1"))
    expect(hashFor("203.0.113.7")).not.toBe(hashFor("203.0.113.8"))
  })
})

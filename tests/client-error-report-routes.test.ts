import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  KNOWN_ROUTE_PATTERNS,
  parseClientErrorReport,
  toKnownRoutePattern,
  toRoutePattern,
} from "@/lib/telemetry/error-report"

function routesOnDisk() {
  const root = path.resolve(process.cwd(), "app")
  const found = new Set<string>()
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/^(page|route)\.(tsx?|jsx?|mdx)$/u.test(entry.name)) {
        const segments = path.relative(root, directory).split(path.sep)
          .filter((segment) => segment && !/^\(.*\)$/u.test(segment))
          .map((segment) => (segment.startsWith("[") ? ":id" : segment))
        found.add(toRoutePattern(`/${segments.join("/")}`))
      }
    }
  }
  walk(root)
  return found
}

describe("which routes a client error report can name", () => {
  it("lists exactly the pages and route handlers the app has", () => {
    // Fails with the difference when a page is added or removed, so the list
    // cannot drift into hiding a real page's faults under "/unknown".
    expect([...KNOWN_ROUTE_PATTERNS].sort()).toEqual([...routesOnDisk()].sort())
  })

  it("keeps a real route, with its identifiers masked", () => {
    expect(toKnownRoutePattern("/coach/members")).toBe("/coach/members")
    expect(toKnownRoutePattern("/coach/financials/players/3f2a1c9e-1111-4222-8333-444455556666"))
      .toBe("/coach/financials/players/:id")
    expect(toKnownRoutePattern("/coach/announcements/summer-camp"))
      .toBe("/coach/announcements/:id")
    expect(toKnownRoutePattern("/coach/announcements/new")).toBe("/coach/announcements/new")
    expect(toKnownRoutePattern("/")).toBe("/")
  })

  it("files an invented route under /unknown", () => {
    expect(toKnownRoutePattern("/aaaa/bbbb/cccc")).toBe("/unknown")
    expect(toKnownRoutePattern("/coach/does-not-exist")).toBe("/unknown")
    expect(toKnownRoutePattern("/login/extra")).toBe("/unknown")
    expect(toKnownRoutePattern("not a path")).toBe("/unknown")
    expect(toKnownRoutePattern(undefined)).toBe("/unknown")
  })

  // This bounds the *vocabulary* of routes a caller can name, not the rate of
  // rows: that is the endpoint's per-address limit, the ten-minute duplicate
  // window, and the 90-day purge (lib/telemetry/retention.ts).
  it("caps how many distinct routes a caller can mint, however many it invents", () => {
    const seen = new Set<string>()
    for (let index = 0; index < 5_000; index += 1) {
      const word = `x${index.toString(36).replace(/[0-9]/gu, (digit) => "abcdefghij"[Number(digit)])}`
      const report = parseClientErrorReport({
        boundary: "root",
        eventType: "client_error",
        errorName: "Error",
        routePath: `/${word}/${word}/${word}`,
        summary: "boom",
      })
      seen.add(report!.routePath)
    }
    expect(seen).toEqual(new Set(["/unknown"]))
  })
})

import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

const appRoot = path.join(process.cwd(), "app")

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

// Segments whose pages render no HTML: `api` is route handlers only, and
// `progress` and `reports` are bare `redirect()` calls kept for old bookmarks.
const NON_RENDERING_SEGMENTS = new Set(["api", "progress", "reports"])

function segmentsRenderingAuthenticatedHtml(): string[] {
  return readdirSync(appRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name !== "(public)" && !NON_RENDERING_SEGMENTS.has(name))
    .sort()
}

describe("portal stylesheet split", () => {
  // app/globals.css is imported by the root layout, so every byte of it ships on
  // `/`, the statically prerendered marketing homepage. Of the class selectors
  // it used to declare, 11 were reachable from the public route tree; the rest
  // moved to app/portal.css, which only the authenticated layouts import.
  it("keeps the shared foundation in the stylesheet the root layout imports", () => {
    const globals = source("app/globals.css")

    // Tailwind ships nothing but its Preflight reset here, and Preflight is
    // load-bearing on the homepage as much as on the portal.
    expect(globals.startsWith('@import "tailwindcss";')).toBe(true)
    expect(globals).toContain(":root {")
    // The public homepage reads these tokens out of app/public-home.css.
    expect(globals).toContain("--ivory: #f7f5f0;")
    expect(source("app/layout.tsx")).toContain('import "./globals.css"')
    expect(source("app/layout.tsx")).not.toContain("portal.css")
  })

  it("keeps every class the public route tree renders out of portal.css", () => {
    const globals = source("app/globals.css")
    const portal = source("app/portal.css")

    // app/(public)/, app/not-found.tsx and the two root error boundaries are the
    // only surfaces outside a login that globals.css styles. Each of these
    // classes appears in their JSX; portal.css may only name one behind a
    // portal class (`.admin-page.page-shell`, `.coach-members-directory-header
    // .eyebrow`), never on its own.
    const publicClasses = [
      "back-link",
      "eyebrow",
      "not-found",
      "page-shell",
      "primary-link",
      "route-recovery",
      "route-recovery-actions",
      "route-recovery-copy",
      "route-recovery-mark",
      "route-recovery-panel",
      "skip-link",
    ]

    for (const className of publicClasses) {
      expect(globals).toContain(`.${className} `)
      expect(portal).not.toMatch(new RegExp(`(^|,\\s*)\\.${className}[\\s,{:]`, "mu"))
    }
  })

  it("imports portal.css from every segment that renders authenticated HTML", () => {
    // Route groups do not nest: a page under app/login/ is wrapped by
    // app/layout.tsx alone and never sees app/(student)/layout.tsx, so each
    // standalone segment needs its own import.
    for (const segment of segmentsRenderingAuthenticatedHtml()) {
      const layout = source(path.join("app", segment, "layout.tsx"))
      expect(layout, `${segment} must import the portal stylesheet`).toContain(
        'import "../portal.css"',
      )
    }
  })
})

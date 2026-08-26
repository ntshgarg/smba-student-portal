import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { compounds, parseRules } from "./support/css-cascade"

const appRoot = path.join(process.cwd(), "app")

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

// Everything a visitor who never signs in can render. app/(public)/ is the
// marketing tree; app/not-found.tsx answers any unmatched URL inside the root
// layout; app/error.tsx and app/global-error.tsx are the root boundaries.
// global-error is the one that decides the shape of this list: it renders when
// the root layout has already failed, so app/globals.css is the only stylesheet
// it gets, and the route-recovery shell it mounts has to be styled from there.
const PUBLIC_ENTRIES = [
  "app/layout.tsx",
  "app/not-found.tsx",
  "app/error.tsx",
  "app/global-error.tsx",
  "app/(public)/layout.tsx",
  "app/(public)/page.tsx",
  "app/(public)/announcements/loading.tsx",
  "app/(public)/announcements/[announcementId]/page.tsx",
]

// `.sr-only` has no reference in the closure and stays in globals.css anyway:
// .21st/DESIGN.md pins it there, declared unlayered and !important, as the single
// visually-hidden utility. Move it behind the login and the homepage, the 404 and
// both error boundaries lose their only way to hide text from sight but not from
// a screen reader. It is the only standing exemption; add another only with a
// reason of that kind.
const GLOBALS_EXEMPTIONS = new Set(["sr-only"])

function resolveImport(specifier: string, from: string): string | null {
  const base = specifier.startsWith("@/")
    ? path.join(process.cwd(), specifier.slice(2))
    : path.resolve(path.dirname(from), specifier)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

/** Every whitespace-separated token of every string or template literal the public
 *  import closure contains. Taking all of them rather than only the ones inside a
 *  `className` keeps this an over-approximation: it can call a class reachable that
 *  is not, never the reverse, so a false pass is impossible in the direction that
 *  would break a page. */
function publicClosureTokens(): Set<string> {
  const seen = new Set<string>()
  const queue = PUBLIC_ENTRIES.map((entry) => path.join(process.cwd(), entry))
  const tokens = new Set<string>()

  while (queue.length) {
    const file = queue.pop()
    if (!file || seen.has(file)) continue
    seen.add(file)
    const contents = readFileSync(file, "utf8")
    for (const match of contents.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/gu)) {
      for (const token of (match[1] ?? match[2] ?? match[3] ?? "").split(/[^\w-]+/u)) {
        if (token) tokens.add(token)
      }
    }
    for (const match of contents.matchAll(/(?:from\s+|import\s*\(\s*)["']([^"']+)["']/gu)) {
      const specifier = match[1]
      if (!specifier.startsWith(".") && !specifier.startsWith("@/")) continue
      const target = resolveImport(specifier, file)
      if (target && /\.tsx?$/u.test(target)) queue.push(target)
    }
  }
  return tokens
}

function compoundsIn(stylesheet: string): Set<string> {
  return new Set(parseRules(stylesheet, "sheet").flatMap((rule) => compounds(rule.selector)))
}

function classSelectorsIn(stylesheet: string): Set<string> {
  return new Set(
    [...compoundsIn(stylesheet)].flatMap((compound) => (
      [...compound.matchAll(/\.(-?[a-zA-Z_][\w-]*)/gu)].map((match) => match[1])
    )),
  )
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
    // Read as parsed compounds rather than as file text: portal.css now carries a
    // header that discusses these class names in prose, and a raw substring match
    // cannot tell a selector from a sentence about one.
    const globals = [...compoundsIn(source("app/globals.css"))]
    const portal = [...compoundsIn(source("app/portal.css"))]

    // app/(public)/, app/not-found.tsx and the two root error boundaries are the
    // only surfaces outside a login that globals.css styles. Each of these
    // classes appears in their JSX; portal.css may only name one behind a
    // portal class (`.admin-page.page-shell`, `.coach-members-directory-header
    // .eyebrow`), never as the subject of its own compound.
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
      const leads = (compound: string) => new RegExp(`^\\.${className}(?![\\w-])`, "u").test(compound)
      expect(globals.filter(leads), `globals.css must style .${className}`).not.toEqual([])
      expect(portal.filter(leads), `portal.css must not lead a compound with .${className}`).toEqual([])
    }
  })

  // The boundary itself, re-derived rather than listed. The audit that produced
  // this split named eleven reachable classes from a hand-read of the tree, and a
  // reviewer "corrected" it to a different eleven by matching `account-menu`
  // inside `header-account-menu`. Substring matching is exactly what this must
  // not do, so the closure is resolved from imports and matched on whole tokens.
  it("keeps nothing in globals.css that the public route tree cannot render", () => {
    const classes = classSelectorsIn(source("app/globals.css"))
    const reachable = publicClosureTokens()
    const unreachable = [...classes].filter((name) => !reachable.has(name) && !GLOBALS_EXEMPTIONS.has(name))

    expect(unreachable).toEqual([])
    // And the exemption is a real one, not a class that quietly became reachable.
    for (const exempt of GLOBALS_EXEMPTIONS) expect(reachable.has(exempt)).toBe(false)
  })

  // The Member Directory shipped its redesign as an override layer instead of an
  // edit, so one composition was declared twice in one cascade and 77
  // declarations could never win. Splitting a stylesheet is how that pattern gets
  // a second file to hide in: two copies of a selector on opposite sides of the
  // boundary resolve purely on which file loads first. None exist, and none may.
  it("declares no selector on both sides of the boundary", () => {
    const globals = compoundsIn(source("app/globals.css"))
    const portal = compoundsIn(source("app/portal.css"))
    const shared = [...globals].filter((compound) => portal.has(compound))

    expect(shared).toEqual([])
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

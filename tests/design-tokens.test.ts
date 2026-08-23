import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

function projectFiles(directory: string, extension: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return projectFiles(entryPath, extension)
    return entry.isFile() && entry.name.endsWith(extension) ? [entryPath] : []
  })
}

function cssFiles(directory: string): string[] {
  return projectFiles(directory, ".css")
}

function stylesheets(): string[] {
  const projectRoot = process.cwd()
  return [
    ...cssFiles(path.join(projectRoot, "app")),
    ...cssFiles(path.join(projectRoot, "components")),
  ]
}

function rootBlock(globals: string): string {
  const start = globals.indexOf(":root {")
  return globals.slice(start, globals.indexOf("}", start))
}

// `next/font` injects these on <html> through the generated font stylesheet, so they are
// never declared in a hand-written stylesheet.
const FONT_VARIABLES = new Set(["--font-manrope", "--font-newsreader"])

// Baseline: both references live inside `.player-attendance-register-table`, a selector no
// element carries since the player register became a focused-month calendar. Removing the
// dead rules (app/globals.css 2870-2941 and 5972) belongs to a dead-selector pass.
const DEAD_RULE_VARIABLES = new Set(["--player-register-width", "--player-register-mobile-width"])

describe("design color tokens", () => {
  it("keeps the soft and strong rose roles centralized", () => {
    const projectRoot = process.cwd()
    const globalsPath = path.join(projectRoot, "app/globals.css")
    const globals = readFileSync(globalsPath, "utf8")
    const strongRoseLiterals = stylesheets().flatMap((stylesheet) => (
      readFileSync(stylesheet, "utf8").match(/#f18b92/giu) ?? []
    ))

    expect(globals).toContain("--rose: #f2a0a5;")
    expect(globals.match(/--rose-strong:\s*#f18b92;/giu)).toHaveLength(1)
    expect(strongRoseLiterals).toHaveLength(1)
  })

  it("keeps quiet player fee states at readable body-text contrast", () => {
    const stylesheet = readFileSync(
      path.join(process.cwd(), "components/financials/player-financials.module.css"),
      "utf8",
    )

    expect(stylesheet).toMatch(/\.monthCell\[data-tone="quiet"\] strong \{\s*color: var\(--steel\);/u)
    expect(stylesheet).not.toMatch(/\.monthCell\[data-tone="quiet"\] strong \{[^}]*color-mix/u)
  })
})

describe("design token layer integrity", () => {
  it("never reads a custom property that nothing declares", () => {
    const projectRoot = process.cwd()
    const sheets = stylesheets()
    const sources = [
      ...projectFiles(path.join(projectRoot, "app"), ".tsx"),
      ...projectFiles(path.join(projectRoot, "components"), ".tsx"),
    ]
    const declared = new Set<string>(FONT_VARIABLES)

    for (const sheet of sheets) {
      for (const match of readFileSync(sheet, "utf8").matchAll(/(?:^|[;{\s])(--[\w-]+)\s*:/gu)) {
        declared.add(match[1])
      }
    }

    // Layout custom properties are also set from React `style` props, which is the only way
    // to feed a runtime-computed width or row count into a stylesheet.
    for (const source of sources) {
      const contents = readFileSync(source, "utf8")
      for (const match of contents.matchAll(/["'`](--[\w-]+)["'`]\s*:/gu)) declared.add(match[1])
      for (const match of contents.matchAll(/setProperty\(\s*["'`](--[\w-]+)/gu)) declared.add(match[1])
    }

    const undeclared = [...sheets, ...sources].flatMap((file) => (
      readFileSync(file, "utf8").split("\n").flatMap((line, index) => (
        [...line.matchAll(/var\(\s*(--[\w-]+)/gu)]
          .filter((match) => !declared.has(match[1]) && !DEAD_RULE_VARIABLES.has(match[1]))
          .map((match) => `${path.relative(projectRoot, file)}:${index + 1} ${match[1]}`)
      ))
    ))

    expect(undeclared).toEqual([])
  })

  it("never repeats a token's value as a raw literal outside :root", () => {
    const projectRoot = process.cwd()
    const globals = readFileSync(path.join(projectRoot, "app/globals.css"), "utf8")
    const tokensByValue = new Map<string, string>()

    for (const match of rootBlock(globals).matchAll(/(--[\w-]+):\s*(#[0-9a-f]{3,8});/giu)) {
      tokensByValue.set(match[2].toLowerCase(), match[1])
    }
    expect(tokensByValue.size).toBeGreaterThan(0)

    const untokenized = stylesheets().flatMap((sheet) => {
      const contents = readFileSync(sheet, "utf8")
      const rootStart = contents.indexOf(":root {")
      const rootEnd = rootStart < 0 ? -1 : contents.indexOf("}", rootStart)
      let offset = 0

      return contents.split("\n").flatMap((line, index) => {
        const lineStart = offset
        offset += line.length + 1
        if (rootStart >= 0 && lineStart >= rootStart && lineStart <= rootEnd) return []
        return [...line.matchAll(/#[0-9a-f]{3,8}\b/giu)]
          .map((match) => ({ literal: match[0], token: tokensByValue.get(match[0].toLowerCase()) }))
          .filter((hit) => hit.token !== undefined)
          .map((hit) => (
            `${path.relative(projectRoot, sheet)}:${index + 1} ${hit.literal} should be var(${hit.token})`
          ))
      })
    })

    expect(untokenized).toEqual([])
  })
})

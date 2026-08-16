import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

function cssFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return cssFiles(entryPath)
    return entry.isFile() && entry.name.endsWith(".css") ? [entryPath] : []
  })
}

describe("design color tokens", () => {
  it("keeps the soft and strong rose roles centralized", () => {
    const projectRoot = process.cwd()
    const globalsPath = path.join(projectRoot, "app/globals.css")
    const globals = readFileSync(globalsPath, "utf8")
    const stylesheets = [
      ...cssFiles(path.join(projectRoot, "app")),
      ...cssFiles(path.join(projectRoot, "components")),
    ]
    const strongRoseLiterals = stylesheets.flatMap((stylesheet) => (
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

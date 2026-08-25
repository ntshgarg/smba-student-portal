import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { IVORY, NAVY, RED, STEEL, WHITE } from "@/lib/pdf-palette"

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

// Blanks every comment while keeping the file's length and line breaks, so a comment that
// documents a token's value cannot be mistaken for a declaration of it.
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//gu, (comment) => comment.replace(/[^\n]/gu, " "))
}

// CSS treats whitespace inside a value as insignificant, so `clamp(58px,7.5vw,102px)` and
// `clamp(58px, 7.5vw, 102px)` are the same duplicate. Match on a pattern that tolerates any
// spacing rather than on the exact bytes, so a reformatted copy cannot slip through.
function spacingTolerantPattern(value: string): RegExp {
  const characters = [...value.replace(/\s+/gu, "")]
  return new RegExp(characters.map((character) => character.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("\\s*"), "giu")
}

// `next/font` injects these on <html> through the generated font stylesheet, so they are
// never declared in a hand-written stylesheet.
const FONT_VARIABLES = new Set(["--font-manrope", "--font-newsreader"])

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

  it("keeps the generated PDFs on the screen palette", () => {
    const globals = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8")
    const tokens = new Map<string, string>()

    for (const match of rootBlock(globals).matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6});/giu)) {
      tokens.set(match[1], match[2].toLowerCase())
    }

    /* A PDF page carries DeviceRGB values, so `lib/pdf-palette.ts` restates
       these five as literals and nothing at runtime re-reads `:root` to notice
       when they part company. Both generators once held their own copy; navy
       had drifted CIE76 ΔE 11.27 and steel ΔE 5.37 off the tokens. */
    expect({
      "--ivory": IVORY,
      "--navy": NAVY,
      "--red": RED,
      "--steel": STEEL,
      "--white": WHITE,
    }).toEqual({
      "--ivory": tokens.get("--ivory"),
      "--navy": tokens.get("--navy"),
      "--red": tokens.get("--red"),
      "--steel": tokens.get("--steel"),
      "--white": tokens.get("--white"),
    })
  })

  it("keeps both PDF generators reading that palette", () => {
    /* The guard above only checks the five exports; it stays green if a
       generator stops importing them. TypeScript blocks a second `const NAVY`,
       but `const BRAND_NAVY = "#081c42"` or an inline `.fillColor("#081c42")`
       reintroduces the drift F-37 removed — and both files already spell some
       colours out, so an inline literal is the habit there, not a hypothetical.
       Every hex a generator is still allowed to own is therefore listed here:
       adding another is a decision someone takes on purpose. */
    const documentOwn: Record<string, string[]> = {
      "lib/reports/pdf.ts": [
        "#d9d8d3", // footer rule
        "#b9c9e5", // the report label sitting on the navy panel
      ],
      "lib/finance/pdf.ts": [
        "#ece9e1", // PALE
        "#176b4d", // GREEN
        "#8a5a00", // AMBER
        "#d2d0c9", // section and footer rules
        "#b9c9e5", // the quiet half of the totals panel
      ],
    }

    const strays = Object.entries(documentOwn).flatMap(([file, own]) => {
      const contents = readFileSync(path.join(process.cwd(), file), "utf8")
      const missingImport = /from "@\/lib\/pdf-palette"/u.test(contents)
        ? []
        : [`${file} no longer imports @/lib/pdf-palette`]

      return [
        ...missingImport,
        ...contents.split("\n").flatMap((line, index) => (
          [...line.matchAll(/#[0-9a-f]{3,8}\b/giu)]
            .filter((match) => !own.includes(match[0].toLowerCase()))
            .map((match) => `${file}:${index + 1} ${match[0]} belongs in @/lib/pdf-palette`)
        )),
      ]
    })

    expect(strays).toEqual([])
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
          .filter((match) => !declared.has(match[1]))
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

  // Hex colors are not the only value that drifts. A `clamp()` is a multi-part expression, so an
  // exact repeat of one is always a copy rather than a coincidence the way a bare `8px` would be
  // — which makes it safe to fail the build on, and it is the class of value F-33 found duplicated
  // across six hand-authored H1 recipes.
  it("never repeats a clamp token's value as a raw literal outside :root", () => {
    const projectRoot = process.cwd()
    const globals = withoutComments(readFileSync(path.join(projectRoot, "app/globals.css"), "utf8"))
    const tokens = [...rootBlock(globals).matchAll(/(--[\w-]+):\s*(clamp\([^;]*\))\s*;/gu)]
      .map((match) => ({ token: match[1], value: match[2].replace(/\s+/gu, " ") }))
    expect(tokens.length).toBeGreaterThan(0)

    const untokenized = stylesheets().flatMap((sheet) => {
      const contents = withoutComments(readFileSync(sheet, "utf8"))
      const rootStart = contents.indexOf(":root {")
      const rootEnd = rootStart < 0 ? -1 : contents.indexOf("}", rootStart)

      return tokens.flatMap(({ token, value }) => (
        [...contents.matchAll(spacingTolerantPattern(value))]
          .filter((match) => rootStart < 0 || match.index < rootStart || match.index > rootEnd)
          .map((match) => {
            const line = contents.slice(0, match.index).split("\n").length
            return `${path.relative(projectRoot, sheet)}:${line} ${value} should be var(${token})`
          })
      ))
    })

    expect(untokenized).toEqual([])
  })
})

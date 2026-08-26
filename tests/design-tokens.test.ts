import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { IVORY, NAVY, RED, STEEL, WHITE } from "@/lib/pdf-palette"

import { parseRules, propertyOf } from "./support/css-cascade"

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

// A token's colour has three spellings, and the hex scan below originally saw one of them.
// `rgba(7, 27, 50, 0.45)` is `--navy` at 45% just as surely as `#071b32` is `--navy`, and
// 156 of the 170 rgba() in these stylesheets — 91.8% — spelled one of five tokens' channel
// triples: --white x61, --ivory x59, --navy x30, --red x4, --green x2. The guard passed
// 7/7 with all 156 in place. Match the comma form the repo writes and the space form CSS
// Color 4 added, so switching to `rgb(7 27 50 / 45%)` is not a way back in.
const CHANNEL_TRIPLE = /rgba?\(\s*(\d+)\s*(?:,\s*|\s+)(\d+)\s*(?:,\s*|\s+)(\d+)\s*(?:[,/]\s*([\d.]+%?))?/giu

/** A token's `#rrggbb` as decimal channels, or null when the token bakes in its own alpha.
 *  `color-mix(in srgb, var(--t) N%, transparent)` sets the alpha itself, so it only stands
 *  in for an rgba() when `var(--t)` is opaque; a 4- or 8-digit token would multiply the two.
 *  All 22 hex tokens are 6-digit today, so nothing takes the null branch yet. */
function expandHex(hex: string): [number, number, number] | null {
  const digits = hex.slice(1)
  if (digits.length === 4 || digits.length === 8) return null
  const wide = digits.length === 3 ? [...digits].map((digit) => digit + digit).join("") : digits
  if (wide.length !== 6) return null
  return [0, 2, 4].map((at) => Number.parseInt(wide.slice(at, at + 2), 16)) as [number, number, number]
}

/** `0.045` -> `4.5`, by moving the decimal point rather than multiplying by 100: `0.07 * 100`
 *  is `7.000000000000001` in IEEE-754, and this string goes into a failure message someone is
 *  meant to paste straight into a stylesheet. */
function asPercentage(alpha: string): string {
  if (alpha.endsWith("%")) return alpha.slice(0, -1)
  const [whole, fraction = ""] = alpha.split(".")
  const padded = fraction.padEnd(2, "0")
  return `${whole}${padded.slice(0, 2)}.${padded.slice(2)}`
    .replace(/0+$/u, "")
    .replace(/\.$/u, "")
    .replace(/^0+(?=\d)/u, "") || "0"
}

function mixFor(token: string, alpha: string | undefined): string {
  if (alpha === undefined) return `var(${token})`
  return `color-mix(in srgb, var(${token}) ${asPercentage(alpha)}%, transparent)`
}

/** A hex literal as the `#rrggbb` the tokens are declared in, plus its alpha byte. `#fff`,
 *  `#ffff`, `#ffffff` and `#ffffffff` are all `--white`, and `#071b3273` is `--navy` at 45%,
 *  but the hex arm compared the whole literal against `tokensByValue` — so of those five
 *  spellings only the 6-digit one could ever match. `#071b3273` is the one that matters:
 *  it is what devtools' colour picker and every CSS minifier print `rgba(7, 27, 50, 0.45)`
 *  back as, which made the oldest spelling the way back in while the modern ones were shut.
 *  The sheets hold zero 3-, 4- and 8-digit hexes today, so this closes a door rather than
 *  cleaning up a leak. */
function normaliseHex(hex: string): { opaque: string; alpha: number } | null {
  const digits = hex.slice(1).toLowerCase()
  if (![3, 4, 6, 8].includes(digits.length)) return null
  const wide = digits.length <= 4 ? [...digits].map((digit) => digit + digit).join("") : digits
  return {
    opaque: `#${wide.slice(0, 6)}`,
    alpha: wide.length === 8 ? Number.parseInt(wide.slice(6), 16) : 255,
  }
}

/** A hex alpha byte as the color-mix percentage that reproduces it. Three decimals is finer
 *  than the byte's own 1/255 = 0.392% step, so the percentage always rounds back to the byte
 *  it came from — `73` -> `45.098%` -> `73` — which matters because this string is written to
 *  be pasted straight into a stylesheet. */
function alphaByteAsPercentage(byte: number): string {
  return `${((byte / 255) * 100).toFixed(3).replace(/\.?0+$/u, "")}%`
}

/** Every token a line spells out as a raw colour literal, one paste-ready replacement each.
 *  `rgba(7, 27, 50, 0.45)`, `rgb(7 27 50 / 45%)` and `#071b3273` are one colour — `--navy` at
 *  45% — and a guard that catches two of the three is a guard with a documented way past it.
 *  Split out of the sheet walk so a test can probe all three directly: planting a literal in
 *  a stylesheet only ever proves the arm that caught it, which is how the third stayed open. */
function untokenisedColours(
  line: string,
  where: string,
  tokensByValue: Map<string, string>,
  tokensByChannels: Map<string, string>,
): string[] {
  return [
    ...[...line.matchAll(/#[0-9a-f]{3,8}\b/giu)].flatMap((match) => {
      const hex = normaliseHex(match[0])
      if (!hex) return []
      const token = tokensByValue.get(hex.opaque)
      if (token === undefined) return []
      const alpha = hex.alpha === 255 ? undefined : alphaByteAsPercentage(hex.alpha)
      return [`${where} ${match[0]} should be ${mixFor(token, alpha)}`]
    }),
    ...[...line.matchAll(CHANNEL_TRIPLE)]
      .map((match) => ({
        literal: match[0],
        alpha: match[4],
        token: tokensByChannels.get([match[1], match[2], match[3]].join(",")),
      }))
      .filter((hit) => hit.token !== undefined)
      .map((hit) => `${where} ${hit.literal}…) should be ${mixFor(hit.token as string, hit.alpha)}`),
  ]
}

// The longhands and shorthands that lay out the space between things. `inset` and the
// physical offsets are left out on purpose: those position an element rather than space
// it, and none of the 2,498 declarations this family covers is one of them.
const SPACING_FAMILY = /^(?:(?:padding|margin)(?:-(?:top|right|bottom|left|inline|block|inline-start|inline-end|block-start|block-end))?|(?:row-|column-|grid-|grid-row-|grid-column-)?gap)$/u

/** A px step, but never the tail of `-16px`, `116px` or `1.5px`. The lookbehind is what
 *  keeps a negative literal out: no --space-* token is negative, so `margin-top: -16px`
 *  has no tokenised spelling. `calc(100% - 16px)` keeps a space before its minus — CSS
 *  requires one — so subtraction still matches while negation does not. */
const SPACING_STEP = /(?<![-\w.])\d+(?:\.\d+)?px/gu

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
    const tokensByChannels = new Map<string, string>()

    for (const match of rootBlock(globals).matchAll(/(--[\w-]+):\s*(#[0-9a-f]{3,8});/giu)) {
      tokensByValue.set(match[2].toLowerCase(), match[1])
      const channels = expandHex(match[2])
      if (channels) tokensByChannels.set(channels.join(","), match[1])
    }
    expect(tokensByValue.size).toBeGreaterThan(0)
    expect(tokensByChannels.size).toBeGreaterThan(0)
    // `normaliseHex` folds every literal to `#rrggbb` and looks the token up by that, which
    // only works while the tokens themselves are declared in that form. All 22 are today.
    // A `#fff` or `#071b3273` token would need the token side folded too, so say so here
    // rather than quietly stop matching it.
    expect([...tokensByValue.keys()].filter((hex) => !/^#[0-9a-f]{6}$/u.test(hex))).toEqual([])

    const untokenized = stylesheets().flatMap((sheet) => {
      // A comment that documents a colour is not a declaration of it — the same reason
      // `withoutComments` already guards the clamp scan below. It also lets a comment
      // quote the rgba() a rule used to carry without re-tripping this guard, which the
      // rgba arm makes possible for the first time.
      const contents = withoutComments(readFileSync(sheet, "utf8"))
      const rootStart = contents.indexOf(":root {")
      const rootEnd = rootStart < 0 ? -1 : contents.indexOf("}", rootStart)
      let offset = 0

      return contents.split("\n").flatMap((line, index) => {
        const lineStart = offset
        offset += line.length + 1
        if (rootStart >= 0 && lineStart >= rootStart && lineStart <= rootEnd) return []
        const where = `${path.relative(projectRoot, sheet)}:${index + 1}`

        return untokenisedColours(line, where, tokensByValue, tokensByChannels)
      })
    })

    expect(untokenized).toEqual([])
  })

  // The guard above is only as good as the spellings it knows, and one colour has several.
  // Probe the reader directly rather than by planting a literal in a stylesheet: a plant only
  // ever proves the arm that caught it, and that is exactly how `#071b3273` went unnoticed —
  // the sheets hold zero 3-, 4- and 8-digit hexes, so the suite stayed green while the bytes
  // devtools' colour picker and every minifier emit for `rgba(7, 27, 50, 0.45)` walked past.
  it("reads a token's colour in every spelling of it", () => {
    const tokensByValue = new Map([["#071b32", "--navy"], ["#ffffff", "--white"]])
    const tokensByChannels = new Map([["7,27,50", "--navy"], ["255,255,255", "--white"]])
    const read = (line: string) => untokenisedColours(line, "probe", tokensByValue, tokensByChannels)
    const navyAt45 = "color-mix(in srgb, var(--navy) 45%, transparent)"

    expect(read("  color: rgba(7, 27, 50, 0.45);")).toEqual([`probe rgba(7, 27, 50, 0.45…) should be ${navyAt45}`])
    expect(read("  color: rgb(7 27 50 / 45%);")).toEqual([`probe rgb(7 27 50 / 45%…) should be ${navyAt45}`])
    // 0x73 is 45.098% of 255, not 45%. The message names the alpha that reproduces the
    // literal, because someone pastes it in as the replacement.
    expect(read("  color: #071b3273;")).toEqual([
      "probe #071b3273 should be color-mix(in srgb, var(--navy) 45.098%, transparent)",
    ])
    // Opaque in any spelling is the token itself: 6-digit, 3-digit shorthand, and either
    // with an `ff` alpha appended.
    expect(read("  color: #071b32;")).toEqual(["probe #071b32 should be var(--navy)"])
    expect(read("  color: #071b32ff;")).toEqual(["probe #071b32ff should be var(--navy)"])
    expect(read("  color: #fff;")).toEqual(["probe #fff should be var(--white)"])
    expect(read("  color: #FFFF;")).toEqual(["probe #FFFF should be var(--white)"])
    expect(read("  color: #fff8;")).toEqual([
      "probe #fff8 should be color-mix(in srgb, var(--white) 53.333%, transparent)",
    ])

    // A colour nobody tokenised stays a colour, in every one of those spellings.
    expect(read("  background: linear-gradient(#ab12cd, #ab12cd80, rgba(171, 18, 205, 0.5));")).toEqual([])
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

  // Spacing drifted for the opposite reason to colour: the tokens were right there and
  // nobody reached for them. 2,498 declarations in the padding/margin/gap family carried
  // 2,936 px occurrences, 581 of which spelled a --space-* token's own value as a literal
  // — and only 69 declarations, 2.8%, held a var() of any kind. Substituting those 581
  // lifted adoption to 619 of 2,498, 24.8%, and this is the only thing that holds it.
  //
  // Deliberately narrow. It fires on an exact match against a declared token and nothing
  // else: `-16px` is excluded because no --space-* token is negative, `18px` and `14px`
  // are excluded because 53.3% of this family's px occurrences are off any 4px grid and
  // snapping them would repaint frozen surfaces. Read over parsed rules rather than raw
  // lines so a value wrapped across two lines is still one value.
  it("never writes a --space-* token's value as a bare px in the spacing family", () => {
    const projectRoot = process.cwd()
    const globals = readFileSync(path.join(projectRoot, "app/globals.css"), "utf8")
    const spaceTokens = new Map<string, string>()

    for (const match of rootBlock(globals).matchAll(/(--space-[\w-]+):\s*([^;]+);/gu)) {
      spaceTokens.set(match[2].trim(), match[1])
    }
    expect(spaceTokens.size).toBeGreaterThan(0)

    const untokenized = stylesheets().flatMap((sheet) => {
      const file = path.relative(projectRoot, sheet)
      return parseRules(readFileSync(sheet, "utf8"), file).flatMap((rule) => {
        if (rule.selector.startsWith("@") || rule.selector === ":root") return []
        return rule.declarations.flatMap((declaration) => {
          const property = propertyOf(declaration.text)
          if (!SPACING_FAMILY.test(property)) return []
          const value = declaration.text.slice(declaration.text.indexOf(":") + 1)
          return [...value.matchAll(SPACING_STEP)]
            .map((match) => ({ step: match[0], token: spaceTokens.get(match[0]) }))
            .filter((hit) => hit.token !== undefined)
            .map((hit) => (
              `${file}:${declaration.line} ${hit.step} in \`${property}\` should be var(${hit.token})`
            ))
        })
      })
    })

    expect(untokenized).toEqual([])
  })
})

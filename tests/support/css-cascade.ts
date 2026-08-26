import { readFileSync } from "node:fs"
import path from "node:path"

// A CSS rule-block reader for assertions that have to reason about what the browser
// resolves rather than about what a stylesheet says. Comments are stripped, at-rule
// nesting is carried on the block as `context`, and every declaration keeps its source
// line so a failure can name the line to look at.
//
// The two portal stylesheets load globals.css first and portal.css second on every
// authenticated route, so `loadCascade()` returns them concatenated in that order:
// that concatenation, not either file alone, is what the cascade actually is.

export type CssRule = {
  file: string
  line: number
  context: string
  selector: string
  declarations: CssDeclaration[]
  index: number
}

export type CssDeclaration = {
  text: string
  line: number
}

export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//gu, (comment) => comment.replace(/[^\n]/gu, " "))
}

export function parseRules(css: string, file: string): CssRule[] {
  const source = stripComments(css)
  const rules: CssRule[] = []
  const openAtRules: string[] = []
  let prelude = ""
  let preludeLine = 1
  let cursor = 0
  let line = 1

  const readQuoted = (): string => {
    const quote = source[cursor]
    let text = quote
    cursor += 1
    while (cursor < source.length) {
      text += source[cursor]
      if (source[cursor] === "\n") line += 1
      if (source[cursor] === "\\") {
        cursor += 1
        if (cursor < source.length) {
          text += source[cursor]
          cursor += 1
        }
        continue
      }
      if (source[cursor] === quote) {
        cursor += 1
        break
      }
      cursor += 1
    }
    return text
  }

  while (cursor < source.length) {
    const character = source[cursor]
    if (prelude.trim() === "") preludeLine = line
    if (character === "\n") {
      line += 1
      prelude += character
      cursor += 1
      continue
    }
    if (character === '"' || character === "'") {
      prelude += readQuoted()
      continue
    }
    if (character === "{") {
      const opened = prelude.trim().replace(/\s+/gu, " ")
      const openedLine = preludeLine
      prelude = ""
      cursor += 1
      // Conditional and grouping at-rules hold further blocks; @font-face and friends
      // hold declarations and are read as one block like any rule.
      if (opened.startsWith("@") && !/^@(font-face|page|property)\b/u.test(opened)) {
        openAtRules.push(opened)
        continue
      }
      const declarations: CssDeclaration[] = []
      let pending = ""
      let pendingLine = line
      let depth = 1
      const flush = () => {
        const text = pending.trim().replace(/\s+/gu, " ")
        if (text) declarations.push({ text, line: pendingLine })
        pending = ""
      }
      while (cursor < source.length) {
        const inner = source[cursor]
        if (pending.trim() === "") pendingLine = line
        if (inner === "\n") {
          line += 1
          pending += inner
          cursor += 1
          continue
        }
        if (inner === '"' || inner === "'") {
          pending += readQuoted()
          continue
        }
        if (inner === "{") {
          depth += 1
          pending += inner
          cursor += 1
          continue
        }
        if (inner === "}") {
          depth -= 1
          if (depth === 0) {
            flush()
            cursor += 1
            break
          }
          pending += inner
          cursor += 1
          continue
        }
        if (inner === ";" && depth === 1) {
          flush()
          cursor += 1
          continue
        }
        pending += inner
        cursor += 1
      }
      rules.push({
        file,
        line: openedLine,
        context: openAtRules.join(" >> "),
        selector: opened,
        declarations,
        index: rules.length,
      })
      continue
    }
    if (character === "}") {
      prelude = ""
      openAtRules.pop()
      cursor += 1
      continue
    }
    if (character === ";" && prelude.trim().startsWith("@")) {
      // A statement at-rule such as @import: no block, no declarations.
      rules.push({
        file,
        line: preludeLine,
        context: openAtRules.join(" >> "),
        selector: prelude.trim().replace(/\s+/gu, " "),
        declarations: [],
        index: rules.length,
      })
      prelude = ""
      cursor += 1
      continue
    }
    prelude += character
    cursor += 1
  }

  if (openAtRules.length) throw new Error(`${file}: unbalanced at-rule ${openAtRules.join(", ")}`)
  return rules
}

export function loadCascade(files: string[] = ["app/globals.css", "app/portal.css"]): CssRule[] {
  return files
    .flatMap((file) => parseRules(readFileSync(path.join(process.cwd(), file), "utf8"), file))
    .map((rule, index) => ({ ...rule, index }))
}

/** The comma-separated selectors of a prelude. Every element a rule reaches, it reaches
 *  through exactly one of these, and two identical compounds always carry identical
 *  specificity — which is what makes source order the whole tie-break between them. */
export function compounds(selector: string): string[] {
  if (selector.startsWith("@")) return []
  return selector.split(",").map((part) => part.trim().replace(/\s+/gu, " ")).filter(Boolean)
}

export function propertyOf(declaration: string): string {
  return declaration.slice(0, declaration.indexOf(":")).trim().toLowerCase()
}

export function isImportant(declaration: string): boolean {
  return /!\s*important\s*$/iu.test(declaration)
}

/** True when `later`'s media context applies everywhere `earlier`'s does: either it is
 *  unconditional, or the two carry the same condition. A rule inside a narrower query
 *  cannot be said to cover an unconditional one. */
function contextCovers(later: string, earlier: string): boolean {
  return later === "" || later === earlier
}

export type ShadowIndex = Map<string, Map<string, { rule: CssRule; declaration: CssDeclaration }[]>>

export function indexByCompound(cascade: CssRule[]): ShadowIndex {
  const index: ShadowIndex = new Map()
  for (const rule of cascade) {
    for (const compound of compounds(rule.selector)) {
      let properties = index.get(compound)
      if (!properties) {
        properties = new Map()
        index.set(compound, properties)
      }
      for (const declaration of rule.declarations) {
        const property = propertyOf(declaration.text)
        const entries = properties.get(property) ?? []
        entries.push({ rule, declaration })
        properties.set(property, entries)
      }
    }
  }
  return index
}

/** The declaration that beats `declaration` for every element `rule` can reach, or null
 *  when no such declaration exists. A hit means the browser never uses `declaration`:
 *  the rules found here match exactly the same elements at exactly the same specificity
 *  and are declared later, so the cascade resolves to them at every viewport. */
export function shadowedBy(
  rule: CssRule,
  declaration: CssDeclaration,
  index: ShadowIndex,
): { rule: CssRule; declaration: CssDeclaration }[] | null {
  const property = propertyOf(declaration.text)
  const important = isImportant(declaration.text)
  const winners: { rule: CssRule; declaration: CssDeclaration }[] = []
  for (const compound of compounds(rule.selector)) {
    const later = (index.get(compound)?.get(property) ?? []).filter((entry) => (
      entry.rule.index > rule.index
      && contextCovers(entry.rule.context, rule.context)
      && (isImportant(entry.declaration.text) || !important)
    ))
    if (!later.length) return null
    winners.push(later[later.length - 1])
  }
  return winners
}

import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { MOTION_ENTER_MS, MOTION_EXIT_MS } from "@/components/motion/motion-tokens"

const root = path.resolve(__dirname, "..")
const globals = readFileSync(path.join(root, "app/globals.css"), "utf8")

function token(name: string) {
  const value = globals.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim()
  if (value === undefined) throw new Error(`--${name} is not declared in app/globals.css`)
  return value
}

function milliseconds(value: string) {
  const match = value.match(/^(\d+(?:\.\d+)?)ms$/)
  if (!match) throw new Error(`${value} is not a millisecond length`)
  return Number(match[1])
}

function stylesheets(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry)
    if (statSync(full).isDirectory()) return stylesheets(full)
    return entry.endsWith(".css") ? [full] : []
  })
}

describe("motion tokens", () => {
  it("keeps menus inside 150-250ms with exits 20% shorter", () => {
    const enter = milliseconds(token("duration-enter"))
    const exit = milliseconds(token("duration-exit"))

    expect(enter).toBeGreaterThanOrEqual(150)
    expect(enter).toBeLessThanOrEqual(250)
    expect(exit).toBeCloseTo(enter * 0.8, 0)
  })

  it("matches the script-side timings the closing menus wait on", () => {
    expect(MOTION_ENTER_MS).toBe(milliseconds(token("duration-enter")))
    expect(MOTION_EXIT_MS).toBe(milliseconds(token("duration-exit")))
  })

  it("pins the press, popover, knob and stagger values", () => {
    expect(token("press-scale")).toBe("0.97")
    expect(token("popover-scale-from")).toBe("0.95")
    expect(token("knob-stretch")).toBe("1.12")
    expect(token("stagger-step")).toBe("30ms")
  })

  // A cubic-bezier whose y control points leave 0..1 overshoots its target and
  // springs back. Everyday transitions in this app settle without a bounce.
  it("uses no overshooting curve anywhere", () => {
    const overshoots = [
      ...stylesheets(path.join(root, "app")),
      ...stylesheets(path.join(root, "components")),
    ].flatMap((file) => {
      const source = readFileSync(file, "utf8")
      return [...source.matchAll(/cubic-bezier\(([^)]+)\)/g)]
        .filter((match) => {
          const [, y1, , y2] = match[1].split(",").map((part) => Number(part.trim()))
          return y1 < 0 || y1 > 1 || y2 < 0 || y2 > 1
        })
        .map((match) => `${path.relative(root, file)}: ${match[0]}`)
    })

    expect(overshoots).toEqual([])
  })
})

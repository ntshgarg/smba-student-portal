import { readFileSync, statSync } from "node:fs"
import path from "node:path"

import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  HERO_SHUTTLE_MEDIA,
  HeroShuttle,
  controlHeroShuttle,
} from "@/components/public/hero-shuttle/hero-shuttle"
import { firstPaintStillOpacity } from "@/components/public/hero-shuttle/shuttle-model"
import type { ShuttleRenderer } from "@/components/public/hero-shuttle/shuttle-renderer"

const root = path.resolve(__dirname, "..")
const source = (file: string) => readFileSync(path.join(root, file), "utf8")
const REDUCED = "(prefers-reduced-motion: reduce)"

describe("hero shuttle markup", () => {
  const html = renderToStaticMarkup(<HeroShuttle />)

  it("sends only the still and an empty watermark canvas: decorative, unfocusable", () => {
    expect(html).toMatch(/^<div class="hero-visual" aria-hidden="true" data-shuttle-state="still">/)
    // the watermark is drawn after load; the live shuttle's canvas is added by the renderer
    expect(html.match(/<canvas/g)).toEqual(["<canvas"])
    expect(html).toContain('<canvas class="hero-shuttle-watermark"></canvas>')
    expect(html).not.toMatch(/tabindex|<a |<button/i)
    expect(html).toContain('<img class="hero-shuttle-still" src="/images/hero-shuttle-spiral.svg" alt=""')
    // sized, so it never shifts the layout; eager, so it never holds back the first view's largest paint
    expect(html).toMatch(/width="1000" height="1000" decoding="async"/)
    expect(html).not.toContain('loading="lazy"')
  })

  it("fetches no still where the slot is hidden", () => {
    // the first <source> wins, so it must come before the reduced-motion one
    expect(html).toContain(`<picture><source media="not all and ${HERO_SHUTTLE_MEDIA}" srcSet="data:image/gif;base64,`)
  })

  it("swaps in the resting shuttle for reduced motion without script", () => {
    expect(html).toContain(`<source media="${REDUCED}" srcSet="/images/hero-shuttle-rest.svg"/>`)
  })

  it("ships both stills as plain, compact line drawings", () => {
    for (const file of ["public/images/hero-shuttle-spiral.svg", "public/images/hero-shuttle-rest.svg"]) {
      const svg = source(file)
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1316 -1316 2632 2632"'), file).toBe(true)
      expect(new Set(svg.match(/<[a-z]+/g)), file).toEqual(new Set(["<svg", "<g", "<path"]))
      expect(statSync(path.join(root, file)).size, file).toBeLessThan(300_000)
    }
  })

  it("hides the slot with the same test the script uses", () => {
    expect(source("app/public-home.css")).toContain(`@media not all and ${HERO_SHUTTLE_MEDIA} {`)
  })

  it("starts the still at the strength the live drawing fades it from, so it never jumps", () => {
    const css = source("app/public-home.css").match(/\.hero-shuttle-still \{[^}]*?opacity: ([\d.]+);/)
    expect(Number(css?.[1])).toBe(firstPaintStillOpacity(0))
  })

  it("keeps the renderer and model out of the page's own bundle", () => {
    const wrapper = source("components/public/hero-shuttle/hero-shuttle.tsx")
    const staticImports = [...wrapper.matchAll(/^import (?!type ).*from "(.+)"$/gm)].map((m) => m[1])
    expect(staticImports.filter((s) => /shuttle-(renderer|model)|tournament-rings/.test(s))).toEqual([])
    expect(wrapper).toContain('import("./shuttle-renderer")')
    expect(wrapper).toContain('import("./tournament-rings")')
    expect(source("app/(public)/page.tsx")).toContain('export const dynamic = "error"')
  })
})

describe("controlHeroShuttle", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function setUp({ shown = true, reduced = false, webgl = true } = {}) {
    const media: Record<string, boolean> = { [HERO_SHUTTLE_MEDIA]: shown, [REDUCED]: reduced }
    const listeners = new Map<string, Set<() => void>>()
    const idle: (() => void)[] = []
    const frames: (() => void)[] = []
    vi.stubGlobal("document", { readyState: "complete" })
    vi.stubGlobal("requestAnimationFrame", (fn: () => void) => frames.push(fn))
    vi.stubGlobal("window", {
      matchMedia: (query: string) => ({
        get matches() { return media[query] },
        addEventListener: (_: string, fn: () => void) => {
          if (!listeners.has(query)) listeners.set(query, new Set())
          listeners.get(query)?.add(fn)
        },
        removeEventListener: (_: string, fn: () => void) => listeners.get(query)?.delete(fn),
      }),
      requestIdleCallback: (fn: () => void) => idle.push(fn),
      cancelIdleCallback: () => idle.splice(0),
      addEventListener: () => {},
      removeEventListener: () => {},
    })

    const renderers: { destroy: ReturnType<typeof vi.fn> }[] = []
    const startShuttle = vi.fn((): ShuttleRenderer | null => {
      if (!webgl) return null
      const r = { destroy: vi.fn() }
      renderers.push(r)
      return r
    })
    const loadRenderer = vi.fn(async () => ({ startShuttle }))
    const stillStyle = new Map<string, string>()
    const still = {
      style: {
        setProperty: (k: string, v: string) => stillStyle.set(k, v),
        removeProperty: (k: string) => stillStyle.delete(k),
      },
    } as unknown as HTMLElement
    const slot = { closest: () => null } as unknown as HTMLElement
    const live: boolean[] = []
    const cleanup = controlHeroShuttle(slot, still, (on) => live.push(on), loadRenderer)

    return {
      loadRenderer, startShuttle, renderers, live, stillStyle, cleanup,
      set(query: string, value: boolean) {
        media[query] = value
        for (const fn of listeners.get(query) ?? []) fn()
      },
      /** Let the idle callback run, which starts the import. */
      runIdle: () => idle.splice(0).forEach((fn) => fn()),
      /** Let the idle callback run, the import resolve and the next frame paint. */
      async settle() {
        idle.splice(0).forEach((fn) => fn())
        await new Promise((r) => setTimeout(r, 0))
        frames.splice(0).forEach((fn) => fn())
      },
      listenerCount: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
    }
  }

  it("never loads the renderer under reduced motion, and starts it when motion is allowed again", async () => {
    const t = setUp({ reduced: true })
    await t.settle()
    expect(t.loadRenderer).not.toHaveBeenCalled()
    expect(t.live).toEqual([])

    t.set(REDUCED, false)
    await t.settle()
    expect(t.loadRenderer).toHaveBeenCalledOnce()
    expect(t.live).toEqual([true])
  })

  it("never loads the renderer on phones or upright tablets", async () => {
    const t = setUp({ shown: false })
    await t.settle()
    expect(t.loadRenderer).not.toHaveBeenCalled()
  })

  it("starts once the page is idle and stops the moment reduced motion is asked for", async () => {
    const t = setUp()
    expect(t.loadRenderer).not.toHaveBeenCalled()
    await t.settle()
    expect(t.startShuttle).toHaveBeenCalledOnce()
    expect(t.live).toEqual([true])

    t.set(REDUCED, true)
    expect(t.renderers[0].destroy).toHaveBeenCalledOnce()
    expect(t.live).toEqual([true, false])
  })

  it("follows a tablet turning upright and back", async () => {
    const t = setUp()
    await t.settle()
    t.set(HERO_SHUTTLE_MEDIA, false)
    expect(t.renderers[0].destroy).toHaveBeenCalledOnce()
    t.set(HERO_SHUTTLE_MEDIA, true)
    await t.settle()
    expect(t.startShuttle).toHaveBeenCalledTimes(2)
    expect(t.live).toEqual([true, false, true])
  })

  it("drops a load that is no longer wanted when it lands", async () => {
    const t = setUp()
    t.runIdle()
    t.set(HERO_SHUTTLE_MEDIA, false)
    await t.settle()
    expect(t.loadRenderer).toHaveBeenCalledOnce()
    expect(t.startShuttle).not.toHaveBeenCalled()
    // another change event while a load is in flight still starts exactly one renderer
    t.set(HERO_SHUTTLE_MEDIA, true)
    t.runIdle()
    t.set(REDUCED, false)
    await t.settle()
    expect(t.loadRenderer).toHaveBeenCalledTimes(2)
    expect(t.startShuttle).toHaveBeenCalledOnce()
    expect(t.live).toEqual([true])
  })

  it("leaves the spiral at full strength without WebGL2, and clears it when stopped", async () => {
    const t = setUp({ webgl: false })
    await t.settle()
    expect(t.stillStyle.get("opacity")).toBe("1")
    expect(t.live).toEqual([])
    t.set(HERO_SHUTTLE_MEDIA, false)
    expect(t.stillStyle.has("opacity")).toBe(false)
  })

  it("tears everything down on unmount", async () => {
    const t = setUp()
    await t.settle()
    t.cleanup()
    expect(t.renderers[0].destroy).toHaveBeenCalledOnce()
    expect(t.listenerCount()).toBe(0)
  })
})

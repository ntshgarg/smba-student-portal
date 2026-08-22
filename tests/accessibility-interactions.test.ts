import type { Locator } from "@playwright/test"
import { describe, expect, it, vi } from "vitest"

import { firstVisible } from "./e2e/support/accessibility-interactions"

function candidate({ expanded }: { expanded: boolean }) {
  return {
    getAttribute: vi.fn().mockResolvedValue(String(expanded)),
    isEnabled: vi.fn().mockResolvedValue(true),
    isVisible: vi.fn().mockResolvedValue(true),
    scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
  } as unknown as Locator
}

function candidates(items: Locator[]) {
  return {
    count: vi.fn().mockResolvedValue(items.length),
    nth: vi.fn((index: number) => items[index]),
  } as unknown as Locator
}

describe("accessibility interaction candidates", () => {
  it("skips an already-expanded attendance session and keeps a stable locator", async () => {
    const expanded = candidate({ expanded: true })
    const collapsed = candidate({ expanded: false })

    const selected = await firstVisible(
      candidates([expanded, collapsed]),
      async (item) => await item.getAttribute("aria-expanded") === "false",
    )

    expect(selected).toBe(collapsed)
    expect(expanded.scrollIntoViewIfNeeded).not.toHaveBeenCalled()
    expect(collapsed.scrollIntoViewIfNeeded).toHaveBeenCalledOnce()
  })

  it("fails clearly when no collapsed attendance session exists", async () => {
    await expect(firstVisible(
      candidates([candidate({ expanded: true })]),
      async (item) => await item.getAttribute("aria-expanded") === "false",
    )).rejects.toThrow("did not find an enabled, visible control")
  })
})

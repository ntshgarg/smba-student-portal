import { describe, expect, it, vi } from "vitest"

import { tryCopyText } from "@/lib/client/clipboard"

describe("tryCopyText", () => {
  it("writes the supplied value when the Clipboard API is available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)

    await expect(tryCopyText("SMBA-1001", { writeText })).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledOnce()
    expect(writeText).toHaveBeenCalledWith("SMBA-1001")
  })

  it("reports an unavailable Clipboard API without throwing", async () => {
    await expect(tryCopyText("SMBA-1001", undefined)).resolves.toBe(false)
  })

  it("reports a denied clipboard write without throwing", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("Permission denied"))

    await expect(tryCopyText("SMBA-1001", { writeText })).resolves.toBe(false)
  })
})

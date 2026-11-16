import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))

import { filterDatesReady } from "@/components/coach/financials/filter-form"

type Field = { name: string; type: "date" | "month"; value: string; validity: { valid: boolean } }

function form(fields: Field[]) {
  return {
    querySelector: (selector: string) => fields.find((field) => selector.includes(`name="${field.name}"`)) ?? null,
    querySelectorAll: () => fields,
  } as unknown as HTMLFormElement
}

const date = (name: string, value: string): Field => ({ name, type: "date", value, validity: { valid: true } })

describe("a self-applying filter's dates", () => {
  it("waits for a whole year rather than one the browser reports mid-typing", () => {
    expect(filterDatesReady(form([date("from", "0002-11-01")]))).toBe(false)
    expect(filterDatesReady(form([date("from", "0202-11-01")]))).toBe(false)
    expect(filterDatesReady(form([date("from", "2026-11-01")]))).toBe(true)
    expect(filterDatesReady(form([{ name: "period", type: "month", value: "0020-11", validity: { valid: true } }]))).toBe(false)
    expect(filterDatesReady(form([{ name: "period", type: "month", value: "2026-11", validity: { valid: true } }]))).toBe(true)
  })

  it("does not apply a range that runs backwards, and lets a cleared date apply", () => {
    expect(filterDatesReady(form([date("from", "2026-11-20"), date("to", "2026-11-01")]))).toBe(false)
    expect(filterDatesReady(form([date("from", "2026-11-01"), date("to", "2026-11-20")]))).toBe(true)
    expect(filterDatesReady(form([date("from", ""), date("to", "2026-11-20")]))).toBe(true)
  })

  it("does not apply a date the browser itself calls invalid", () => {
    expect(filterDatesReady(form([{ ...date("from", "2026-02-30"), validity: { valid: false } }]))).toBe(false)
  })
})

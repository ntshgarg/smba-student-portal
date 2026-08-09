import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const mocks = vi.hoisted(() => ({
  listActiveHomepageAnnouncements: vi.fn(),
}))

vi.mock("@/lib/announcements/queries", () => ({
  listActiveHomepageAnnouncements: mocks.listActiveHomepageAnnouncements,
}))

import { GET } from "@/app/api/public/announcements/route"

describe("public announcements endpoint", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mocks.listActiveHomepageAnnouncements.mockReset()
  })

  it("returns only the narrow public summary and cache-safe headers", async () => {
    mocks.listActiveHomepageAnnouncements.mockReturnValue([{
      id: "announcement-one",
      title: "Training update",
      preview: "Training begins on time.",
      publishedAt: "2026-08-09T04:30:00.000Z",
      expiresOn: null,
      pinned: true,
    }])

    const response = await GET()
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control"))
      .toBe("public, max-age=0, s-maxage=60, stale-while-revalidate=300")
    expect(await response.json()).toEqual({
      announcements: [{
        id: "announcement-one",
        title: "Training update",
        preview: "Training begins on time.",
        publishedAt: "2026-08-09T04:30:00.000Z",
        expiresOn: null,
        pinned: true,
      }],
    })
  })

  it("degrades to an empty notice board when persistence is unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    mocks.listActiveHomepageAnnouncements.mockImplementation(() => {
      throw new Error("database unavailable")
    })

    const response = await GET()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ announcements: [] })
  })
})

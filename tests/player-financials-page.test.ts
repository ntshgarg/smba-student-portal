import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const mocks = vi.hoisted(() => ({
  getCurrentStudent: vi.fn(),
  getPlayerFeeRecord: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT")
  }),
}))

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("@/lib/student/current-student", () => ({
  getCurrentStudent: mocks.getCurrentStudent,
}))
vi.mock("@/lib/finance/service", () => ({
  getPlayerFeeRecord: mocks.getPlayerFeeRecord,
}))

import PlayerFinancialsPage from "@/app/(student)/player/financials/page"

describe("player financials page ownership boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getPlayerFeeRecord.mockResolvedValue(null)
  })

  it("queries the fee record only with the authenticated player's immutable account id", async () => {
    mocks.getCurrentStudent.mockResolvedValue({
      identity: {
        playerId: "authenticated-player",
        academyId: "SMBA#0002",
        fullName: "Mira Rao",
        firstName: "Mira",
        initials: "MR",
      },
      profile: {},
    })

    await PlayerFinancialsPage()

    expect(mocks.getPlayerFeeRecord).toHaveBeenCalledOnce()
    expect(mocks.getPlayerFeeRecord).toHaveBeenCalledWith("authenticated-player")
  })

  it("ignores a forged player query value and keeps the authenticated owner boundary", async () => {
    mocks.getCurrentStudent.mockResolvedValue({
      identity: {
        playerId: "authenticated-player",
        academyId: "SMBA#0002",
        fullName: "Mira Rao",
        firstName: "Mira",
        initials: "MR",
      },
      profile: {},
    })

    const renderWithUntrustedProps = PlayerFinancialsPage as unknown as (props: {
      searchParams: Promise<Record<string, string>>
    }) => Promise<unknown>
    await renderWithUntrustedProps({
      searchParams: Promise.resolve({ player: "another-player" }),
    })

    expect(mocks.getPlayerFeeRecord).toHaveBeenCalledOnce()
    expect(mocks.getPlayerFeeRecord).toHaveBeenCalledWith("authenticated-player")
    expect(mocks.getPlayerFeeRecord).not.toHaveBeenCalledWith("another-player")
  })

  it("redirects guests before making a finance query", async () => {
    mocks.getCurrentStudent.mockResolvedValue(null)

    await expect(PlayerFinancialsPage()).rejects.toThrow("NEXT_REDIRECT")
    expect(mocks.getPlayerFeeRecord).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const mocks = vi.hoisted(() => ({
  completePlayerOnboardingFinance: vi.fn(),
  findAccountContact: vi.fn(),
  sendSecurityNotice: vi.fn(),
}))

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/auth/account-service", () => ({
  findAccountContact: mocks.findAccountContact,
}))
vi.mock("@/lib/auth/current-coach", () => ({
  requireHeadAdminAction: vi.fn(async () => ({ subjectId: "coach-1" })),
}))
vi.mock("@/lib/auth/mailer", () => ({
  createAuthMailer: () => ({ sendSecurityNotice: mocks.sendSecurityNotice }),
}))
vi.mock("@/lib/finance/service", () => ({
  FinanceServiceError: class extends Error {},
  completePlayerOnboardingFinance: mocks.completePlayerOnboardingFinance,
}))

import { completeOnboardingFinanceAction } from "@/app/coach/financials/actions"
import type { CommitOnboardingFinanceInput } from "@/lib/finance/types"

const input = { playerId: "player-1" } as CommitOnboardingFinanceInput

describe("telling the family when onboarding is finished", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.completePlayerOnboardingFinance.mockReturnValue({
      createdMonthlyChargeIds: ["charge-1"],
      reused: false,
    })
    mocks.findAccountContact.mockReturnValue({
      contactEmail: "family@example.com",
      fullName: "Mira Rao",
    })
  })

  it("emails the family that they can now set a password", async () => {
    await expect(completeOnboardingFinanceAction(input)).resolves.toEqual({
      ok: true,
      message: "Onboarding completed; registration and 1 monthly fee issued",
    })
    expect(mocks.sendSecurityNotice).toHaveBeenCalledWith(expect.objectContaining({
      subject: "You can now set your SMBA password",
      to: "family@example.com",
    }))
  })

  it("does not email again when the fees were already issued", async () => {
    mocks.completePlayerOnboardingFinance.mockReturnValue({
      createdMonthlyChargeIds: [],
      reused: true,
    })
    await completeOnboardingFinanceAction(input)
    expect(mocks.sendSecurityNotice).not.toHaveBeenCalled()
  })

  it("tells the coach when the email could not be sent", async () => {
    mocks.sendSecurityNotice.mockRejectedValue(new Error("delivery down"))
    await expect(completeOnboardingFinanceAction(input)).resolves.toEqual({
      ok: true,
      message: "Onboarding completed; registration and 1 monthly fee issued; "
        + "the family could not be emailed, so tell them they can now set a password",
    })
  })
})

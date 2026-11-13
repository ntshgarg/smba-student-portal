import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const order: string[] = []
  return {
    clearDatabaseSession: vi.fn(async () => { order.push("signed-out") }),
    cookieDelete: vi.fn((name: string) => { order.push(`delete:${name}`) }),
    cookieSet: vi.fn((name: string) => { order.push(`set:${name}`) }),
    createHeadCoachSetupClaim: vi.fn(() => ({ expiresAt: new Date(), token: "setup-token" })),
    order,
    redirect: vi.fn((target: string) => {
      order.push(`redirect:${target}`)
      throw Object.assign(new Error(`redirect:${target}`), { target })
    }),
  }
})

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ delete: mocks.cookieDelete, set: mocks.cookieSet })),
}))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("@/lib/auth/session", () => ({
  clearDatabaseSession: mocks.clearDatabaseSession,
  getRawAuthSession: vi.fn(async () => ({
    session: { token: "owner-session" },
    user: { id: "owner", twoFactorEnabled: true },
  })),
}))
vi.mock("@/lib/auth/admin-preview", () => ({
  ADMIN_PREVIEW_COOKIE: "smba_admin_preview",
  createAdminPreviewToken: vi.fn(),
}))
vi.mock("@/lib/auth/initial-setup", () => ({
  createHeadCoachSetupClaim: mocks.createHeadCoachSetupClaim,
  HEAD_COACH_SETUP_COOKIE: "smba_head_coach_setup",
  headCoachSetupAvailable: vi.fn(() => true),
}))
vi.mock("@/lib/auth/security-context", () => ({ writeAuthSecurityEvent: vi.fn() }))
vi.mock("@/lib/auth/authenticator-reset-service", () => ({
  approveAuthenticatorResetRequest: vi.fn(),
  rejectAuthenticatorResetRequest: vi.fn(),
}))
// Every query in the owner check resolves to the platform owner's row.
vi.mock("@/lib/db/client", () => {
  const chain: Record<string, unknown> = new Proxy({}, {
    get: (_target, property) => property === "get"
      ? () => ({ role: "platform_admin" })
      : () => chain,
  })
  return { initializeDatabase: () => chain }
})

import { openHeadCoachSetupAction } from "@/app/admin/actions"

/*
 * The owner opens head-coach setup on the coach's own device, and the device is
 * then handed over. The owner's sign-in used to stay on it -- the console,
 * dashboard previews and authenticator approvals one address-bar edit away --
 * and a hiccup in the coach's first sign-in dropped them into the owner console.
 */
describe("opening head-coach setup on the coach's device", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.order.length = 0
  })

  it("signs the owner out of that browser before handing it to the setup page", async () => {
    await expect(openHeadCoachSetupAction()).rejects.toMatchObject({ target: "/setup/head-coach" })

    expect(mocks.createHeadCoachSetupClaim).toHaveBeenCalledWith({
      claimImmediately: true,
      createdByAccountId: "owner",
    })
    expect(mocks.cookieSet).toHaveBeenCalledWith("smba_head_coach_setup", "setup-token", expect.objectContaining({
      path: "/setup/head-coach",
    }))
    expect(mocks.clearDatabaseSession).toHaveBeenCalledOnce()
    expect(mocks.cookieDelete).toHaveBeenCalledWith("smba_admin_preview")
    expect(mocks.order.indexOf("signed-out")).toBeLessThan(mocks.order.indexOf("redirect:/setup/head-coach"))
    expect(mocks.order.indexOf("set:smba_head_coach_setup")).toBeLessThan(mocks.order.indexOf("signed-out"))
  })

  it("marks the setup pass secure on a production host outside Vercel", async () => {
    vi.stubEnv("VERCEL", "")
    vi.stubEnv("NODE_ENV", "production")
    try {
      await expect(openHeadCoachSetupAction()).rejects.toMatchObject({ target: "/setup/head-coach" })
    } finally {
      vi.unstubAllEnvs()
    }
    expect(mocks.cookieSet).toHaveBeenCalledWith("smba_head_coach_setup", "setup-token", expect.objectContaining({
      secure: true,
    }))
  })
})

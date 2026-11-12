import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { renderToStaticMarkup } from "react-dom/server"

const standing = vi.hoisted(() => ({
  adminPreviewStillStands: vi.fn<(input: {
    actorAccountId: string
    sessionToken: string
    targetAccountId: string
  }) => boolean>(() => true),
}))

vi.mock("server-only", () => ({}))
// The server half of the proxy's test is held to a real database in
// tests/admin-preview-standing.test.ts; here it is a switch.
vi.mock("@/lib/auth/admin-preview-standing", () => standing)

import {
  createAdminPreviewToken,
  readAdminPreviewRecord,
  readAdminPreviewToken,
  readLiveAdminPreviewClaim,
  sessionTokenFromCookieValue,
} from "@/lib/auth/admin-preview"
import { AdminPreviewBanner } from "@/components/admin-preview-banner"
import { proxy } from "@/proxy"

const SESSION_TOKEN = "ownerSessionToken0123456789abcdef"
// Better Auth's signed cookie value: `token.signature`, URL-encoded.
const SESSION_COOKIE = `smba.session_token=${encodeURIComponent(`${SESSION_TOKEN}.c2lnbmF0dXJlK3NsYXNoLw==`)}`

function livePreviewCookie(now = new Date()) {
  return `smba_admin_preview=${createAdminPreviewToken({
    actorAccountId: "owner",
    sessionToken: SESSION_TOKEN,
    targetAccountId: "player",
  }, now)}`
}

function post(path: string, cookie: string) {
  return proxy(new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { cookie },
  }))
}

function clearsPreviewCookie(response: Response) {
  return /smba_admin_preview=;/u.test(response.headers.get("set-cookie") ?? "")
}

beforeEach(() => {
  standing.adminPreviewStillStands.mockReset()
  standing.adminPreviewStillStands.mockReturnValue(true)
})

describe("platform-owner preview claims", () => {
  it("binds a short-lived signed preview to its owner, target and sign-in", () => {
    const now = new Date("2026-08-18T12:00:00Z")
    const token = createAdminPreviewToken({
      actorAccountId: "owner",
      sessionToken: SESSION_TOKEN,
      targetAccountId: "player",
    }, now)
    expect(readAdminPreviewToken(token, "owner", SESSION_TOKEN, now)).toMatchObject({
      actorAccountId: "owner",
      targetAccountId: "player",
    })
    expect(readAdminPreviewToken(token, "different-owner", SESSION_TOKEN, now)).toBeNull()
    expect(readAdminPreviewToken(token, "owner", "a-later-sign-in", now)).toBeNull()
    expect(readAdminPreviewToken(token, "owner", null, now)).toBeNull()
    expect(readAdminPreviewToken(`${token}tampered`, "owner", SESSION_TOKEN, now)).toBeNull()
    expect(readAdminPreviewToken(
      token,
      "owner",
      SESSION_TOKEN,
      new Date(now.getTime() + 60 * 60 * 1000 + 1),
    )).toBeNull()
  })

  it("reads the session token out of the signed sign-in cookie", () => {
    const value = SESSION_COOKIE.split("=").slice(1).join("=")
    expect(sessionTokenFromCookieValue(value)).toBe(SESSION_TOKEN)
    expect(sessionTokenFromCookieValue(undefined)).toBeNull()
    expect(readLiveAdminPreviewClaim(
      livePreviewCookie().split("=")[1],
      sessionTokenFromCookieValue(value),
    )).not.toBeNull()
  })

  it("blocks mutations during a live preview while allowing the explicit preview-exit post", () => {
    const cookie = `${livePreviewCookie()}; ${SESSION_COOKIE}`
    expect(post("/coach/actions", cookie).status).toBe(403)
    expect(post("/login", cookie).status).toBe(403)
    expect(post("/admin/preview/exit", cookie).status).toBe(200)

    const navigation = proxy(new NextRequest("http://localhost:3000/coach", {
      method: "GET",
      headers: { cookie },
    }))
    expect(navigation.status).toBe(200)
  })

  it("keeps the secure sign-in cookie name working as well", () => {
    const secureCookie = SESSION_COOKIE.replace("smba.session_token", "__Secure-smba.session_token")
    expect(post("/coach/actions", `${livePreviewCookie()}; ${secureCookie}`).status).toBe(403)
  })

  it("clears a leftover preview cookie instead of blocking every form on the browser", () => {
    // The owner's sign-in is gone: signing in again (or registering, or
    // recovering a password) must still work on this computer.
    const signedOut = post("/login", livePreviewCookie())
    expect(signedOut.status).toBe(200)
    expect(clearsPreviewCookie(signedOut)).toBe(true)

    // Someone else signed in on the same browser.
    const otherSignIn = post(
      "/coach/actions",
      `${livePreviewCookie()}; smba.session_token=someoneElse0123456789.sig`,
    )
    expect(otherSignIn.status).toBe(200)
    expect(clearsPreviewCookie(otherSignIn)).toBe(true)

    // Unsigned or expired values.
    expect(post("/login", `smba_admin_preview=present; ${SESSION_COOKIE}`).status).toBe(200)
    const expired = post(
      "/login",
      `${livePreviewCookie(new Date(Date.now() - 2 * 60 * 60 * 1000))}; ${SESSION_COOKIE}`,
    )
    expect(expired.status).toBe(200)
    expect(clearsPreviewCookie(expired)).toBe(true)
  })

  it("lets forms through once the owner's sign-in was ended from another device", () => {
    // Log out other devices, Revoke, a password change or recovery on the
    // phone: the laptop keeps its old sign-in cookie, which still matches the
    // preview, but the server no longer has that sign-in.
    standing.adminPreviewStillStands.mockReturnValue(false)
    const response = post("/login", `${livePreviewCookie()}; ${SESSION_COOKIE}`)
    expect(response.status).toBe(200)
    expect(clearsPreviewCookie(response)).toBe(true)
    expect(standing.adminPreviewStillStands).toHaveBeenCalledWith({
      actorAccountId: "owner",
      sessionToken: SESSION_TOKEN,
      targetAccountId: "player",
    })
  })

  it("asks the server only before refusing a form, and stays read-only if it cannot answer", () => {
    const cookie = `${livePreviewCookie()}; ${SESSION_COOKIE}`
    proxy(new NextRequest("http://localhost:3000/coach", { headers: { cookie }, method: "GET" }))
    post("/admin/preview/exit", cookie)
    expect(standing.adminPreviewStillStands).not.toHaveBeenCalled()

    standing.adminPreviewStillStands.mockImplementation(() => {
      throw new Error("database unavailable")
    })
    expect(post("/coach/actions", cookie).status).toBe(403)
  })

  it("still names the person viewed for the stop record after the hour runs out", () => {
    const started = new Date(Date.now() - 65 * 60 * 1000)
    const token = livePreviewCookie(started).split("=")[1]
    expect(readAdminPreviewToken(token, "owner", SESSION_TOKEN)).toBeNull()
    expect(readAdminPreviewRecord(token, "owner")).toMatchObject({ targetAccountId: "player" })
    expect(readAdminPreviewRecord(token, "someone-else")).toBeNull()
    expect(readAdminPreviewRecord(`${token}tampered`, "owner")).toBeNull()
  })

  it("does not expose preview exit as a prefetchable GET link", () => {
    const markup = renderToStaticMarkup(AdminPreviewBanner({ label: "Head coach" }))
    expect(markup).toContain('action="/admin/preview/exit"')
    expect(markup).toContain('method="post"')
    expect(markup).not.toContain('href="/admin/preview/exit"')
  })

  it("says so, and offers to close the preview, when the person being viewed is no longer available", () => {
    const markup = renderToStaticMarkup(AdminPreviewBanner({ label: null }))
    expect(markup).toContain("no longer")
    expect(markup).toContain("Close preview")
    expect(markup).toContain('action="/admin/preview/exit"')
  })
})

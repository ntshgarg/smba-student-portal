import { describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { renderToStaticMarkup } from "react-dom/server"

vi.mock("server-only", () => ({}))
import {
  createAdminPreviewToken,
  readAdminPreviewToken,
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

  it("does not expose preview exit as a prefetchable GET link", () => {
    const markup = renderToStaticMarkup(AdminPreviewBanner({ label: "Head coach" }))
    expect(markup).toContain('action="/admin/preview/exit"')
    expect(markup).toContain('method="post"')
    expect(markup).not.toContain('href="/admin/preview/exit"')
  })
})

import { describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("server-only", () => ({}))

import {
  createAdminPreviewToken,
  readAdminPreviewToken,
} from "@/lib/auth/admin-preview"
import { proxy } from "@/proxy"

describe("platform-owner preview claims", () => {
  it("binds a short-lived signed preview to its owner and target", () => {
    const now = new Date("2026-08-18T12:00:00Z")
    const token = createAdminPreviewToken({
      actorAccountId: "owner",
      targetAccountId: "player",
    }, now)
    expect(readAdminPreviewToken(token, "owner", now)).toMatchObject({
      actorAccountId: "owner",
      targetAccountId: "player",
    })
    expect(readAdminPreviewToken(token, "different-owner", now)).toBeNull()
    expect(readAdminPreviewToken(`${token}tampered`, "owner", now)).toBeNull()
    expect(readAdminPreviewToken(token, "owner", new Date(now.getTime() + 60 * 60 * 1000 + 1)))
      .toBeNull()
  })

  it("blocks every mutation while a preview cookie is present", () => {
    const mutation = proxy(new NextRequest("http://localhost:3000/coach/actions", {
      method: "POST",
      headers: { cookie: "smba_admin_preview=present" },
    }))
    expect(mutation.status).toBe(403)
    const navigation = proxy(new NextRequest("http://localhost:3000/coach", {
      method: "GET",
      headers: { cookie: "smba_admin_preview=present" },
    }))
    expect(navigation.status).toBe(200)
  })
})

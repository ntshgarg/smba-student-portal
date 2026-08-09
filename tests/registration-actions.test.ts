import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  clearDatabaseSession: vi.fn(),
  createDatabaseSession: vi.fn(),
  findApprovedAccountByAcademyId: vi.fn(),
  prototypeAcademyIdAuthEnabled: vi.fn(() => true),
  redirect: vi.fn(),
  registerPublicPlayerRequest: vi.fn(),
}))

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))

vi.mock("@/lib/auth/account-service", () => ({
  findApprovedAccountByAcademyId: mocks.findApprovedAccountByAcademyId,
  prototypeAcademyIdAuthEnabled: mocks.prototypeAcademyIdAuthEnabled,
  registerPublicPlayerRequest: mocks.registerPublicPlayerRequest,
}))

vi.mock("@/lib/auth/session", () => ({
  clearDatabaseSession: mocks.clearDatabaseSession,
  createDatabaseSession: mocks.createDatabaseSession,
}))

import {
  submitRegistration,
  type RegistrationFormState,
} from "@/app/login/actions"
import { OperationalActionError } from "@/lib/actions/operational-result"

const REQUEST_KEY = "11111111-1111-4111-8111-111111111111"
const initialState: RegistrationFormState = {
  error: null,
  errorField: null,
  submitted: false,
}

function registrationData(
  fullName: string,
  requestedRole?: string,
  registrationRequestKey = REQUEST_KEY,
) {
  const formData = new FormData()
  formData.set("fullName", fullName)
  formData.set("registrationRequestKey", registrationRequestKey)
  if (requestedRole) formData.set("requestedRole", requestedRole)
  return formData
}

describe("public registration action", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prototypeAcademyIdAuthEnabled.mockReturnValue(true)
  })

  it("registers a valid public request as a player", async () => {
    const result = await submitRegistration(
      initialState,
      registrationData("  Mira   Rao  "),
    )

    expect(result).toEqual({ error: null, errorField: null, submitted: true })
    expect(mocks.registerPublicPlayerRequest).toHaveBeenCalledOnce()
    expect(mocks.registerPublicPlayerRequest).toHaveBeenCalledWith({
      fullName: "Mira Rao",
      requestKey: REQUEST_KEY,
    })
  })

  it("ignores a forged coach role and still registers a player", async () => {
    const result = await submitRegistration(
      initialState,
      registrationData("Riya Coach", "coach"),
    )

    expect(result).toEqual({ error: null, errorField: null, submitted: true })
    expect(mocks.registerPublicPlayerRequest).toHaveBeenCalledWith({
      fullName: "Riya Coach",
      requestKey: REQUEST_KEY,
    })
  })

  it("does not persist invalid or disabled registration requests", async () => {
    await expect(
      submitRegistration(initialState, registrationData("A")),
    ).resolves.toEqual({
      error: "Enter your full name.",
      errorField: "fullName",
      submitted: false,
    })
    expect(mocks.registerPublicPlayerRequest).not.toHaveBeenCalled()

    mocks.prototypeAcademyIdAuthEnabled.mockReturnValue(false)
    await expect(
      submitRegistration(initialState, registrationData("Mira Rao")),
    ).resolves.toEqual({
      error: "Prototype registration is disabled.",
      errorField: null,
      submitted: false,
    })
    expect(mocks.registerPublicPlayerRequest).not.toHaveBeenCalled()
  })

  it("returns request-key conflicts as recoverable form errors", async () => {
    mocks.registerPublicPlayerRequest.mockImplementationOnce(() => {
      throw new OperationalActionError(
        "CONFLICT",
        "This registration request has changed. Refresh the page before trying again.",
        "registrationRequestKey",
      )
    })

    await expect(
      submitRegistration(initialState, registrationData("Mira Rao")),
    ).resolves.toEqual({
      error: "This registration request has changed. Refresh the page before trying again.",
      errorField: null,
      submitted: false,
    })
  })

  it("does not hide unexpected persistence failures", async () => {
    mocks.registerPublicPlayerRequest.mockImplementationOnce(() => {
      throw new Error("database unavailable")
    })

    await expect(
      submitRegistration(initialState, registrationData("Mira Rao")),
    ).rejects.toThrow("database unavailable")
  })
})

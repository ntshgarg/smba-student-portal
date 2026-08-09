import { describe, expect, it } from "vitest"

import {
  createSessionIdentity,
  createStudentIdentity,
  formatAcademyId,
  normalizeAcademyId,
  normalizeFullName,
} from "@/lib/auth/identity"

describe("shared account identity", () => {
  it("normalizes names without restricting valid Unicode characters", () => {
    expect(normalizeFullName("  Anaïs   D’Souza  ")).toBe("Anaïs D’Souza")
  })

  it("normalizes and formats human-friendly Academy IDs", () => {
    expect(normalizeAcademyId(" smba#0007 ")).toBe("SMBA#0007")
    expect(formatAcademyId(7)).toBe("SMBA#0007")
  })

  it("creates role-aware session identities around immutable account IDs", () => {
    expect(createSessionIdentity({
      accountId: "4d9c4a1e-7e85-4f63-b44d-cf2a472f94e3",
      academyId: "SMBA#0007",
      fullName: "Mira Rao",
      role: "player",
    })).toMatchObject({
      role: "player",
      subjectId: "4d9c4a1e-7e85-4f63-b44d-cf2a472f94e3",
      firstName: "Mira",
      initials: "MR",
    })
  })

  it("derives a student view without changing the account identifier", () => {
    const session = createSessionIdentity({
      accountId: "player-account-uuid",
      academyId: "SMBA#0008",
      fullName: "சஞ்சய் குமார்",
      role: "player",
    })

    expect(createStudentIdentity(session)).toMatchObject({
      playerId: "player-account-uuid",
      academyId: "SMBA#0008",
      fullName: "சஞ்சய் குமார்",
    })
  })
})

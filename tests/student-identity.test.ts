import { describe, expect, it } from "vitest"

import {
  academyIdSerial,
  createSessionIdentity,
  createStudentIdentity,
  formatAcademyId,
  isAcademyId,
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
    expect(formatAcademyId(10_001)).toBe("SMBA-JC-0001")
    expect(formatAcademyId(20_001)).toBe("SMBA-PL-0001")
    expect(formatAcademyId(30_001)).toBe("SMBA-HC-0001")
    expect(isAcademyId("smba-admin-0001")).toBe(true)
  })

  it("parses legacy and role-prefixed Academy IDs back to their serials", () => {
    expect(academyIdSerial("SMBA#0001")).toBe(1)
    expect(academyIdSerial("smba-jc-0001")).toBe(10_001)
    expect(academyIdSerial("SMBA-PL-0001")).toBe(20_001)
    expect(academyIdSerial("SMBA-HC-0001")).toBe(30_001)
    expect(academyIdSerial("SMBA-PL-0000")).toBeNull()
    expect(academyIdSerial("SMBA-ADMIN-0001")).toBeNull()
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

import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const { registrationIdentity, normalizeRegistrationPhone, validateRegistrationDateOfBirth } =
  await import("@/lib/auth/account-service")

/*
 * The identity key is the whole feature in one function: it decides what counts
 * as "the same person registering again". Every assertion below is a decision
 * someone could reasonably reverse later, so each one states why it is that way.
 */

function key(fullName: string, email: string) {
  const identity = registrationIdentity(fullName, email)
  expect(identity).not.toBeNull()
  return identity!.subjectKey
}

describe("registration identity key", () => {
  describe("collapses what is the same person", () => {
    it("ignores surrounding and repeated whitespace in the name", () => {
      expect(key(" Arjun   Sharma ", "rakesh@example.com"))
        .toBe(key("Arjun Sharma", "rakesh@example.com"))
    })

    it("ignores case in both halves", () => {
      expect(key("ARJUN SHARMA", "Rakesh@Example.COM"))
        .toBe(key("arjun sharma", "rakesh@example.com"))
    })

    it("ignores whitespace around the address", () => {
      expect(key("Arjun Sharma", "  rakesh@example.com  "))
        .toBe(key("Arjun Sharma", "rakesh@example.com"))
    })

    it("folds a decomposed Devanagari nukta onto its precomposed form", () => {
      // U+0958 vs U+0915 U+093C. Identical on screen, different bytes -- a parent
      // pasting a name from a message and one typing it fresh must not become two
      // people. This is the case NFKC is here for.
      expect(key("क़श्मीरा", "rakesh@example.com"))
        .toBe(key("क़श्मीरा", "rakesh@example.com"))
    })

    it("folds a decomposed Latin accent onto its precomposed form", () => {
      expect(key("Anaïs Rao", "rakesh@example.com"))
        .toBe(key("Anaïs Rao", "rakesh@example.com"))
    })

    it("folds fullwidth Latin onto ASCII", () => {
      expect(key("Ｍｉｒａ Ｒａｏ", "rakesh@example.com"))
        .toBe(key("Mira Rao", "rakesh@example.com"))
    })

    it("is idempotent", () => {
      const identity = registrationIdentity(" Arjun   Sharma ", " Rakesh@Example.com ")!
      expect(key(identity.normalizedName, identity.normalizedEmail)).toBe(identity.subjectKey)
    })
  })

  describe("keeps apart what is not the same person", () => {
    it("preserves Gmail dots", () => {
      // Deliberate. Gmail treats these as one inbox and other providers do not;
      // folding them would merge two genuinely distinct addresses elsewhere and
      // lock a real family out with no route forward. The cost is that one person
      // can hold both -- which the coach reviewing every request sees.
      expect(key("Arjun Sharma", "r.a.kesh@gmail.com"))
        .not.toBe(key("Arjun Sharma", "rakesh@gmail.com"))
    })

    it("preserves plus-addressing", () => {
      expect(key("Arjun Sharma", "rakesh+arjun@gmail.com"))
        .not.toBe(key("Arjun Sharma", "rakesh@gmail.com"))
    })

    it("separates twins on one address", () => {
      expect(key("Arjun Sharma", "rakesh@example.com"))
        .not.toBe(key("Ananya Sharma", "rakesh@example.com"))
    })

    it("separates the same name on two addresses", () => {
      expect(key("Arjun Sharma", "rakesh@example.com"))
        .not.toBe(key("Arjun Sharma", "meera@example.com"))
    })

    it("cannot have its name and address boundary slid", () => {
      /*
       * The key joins the two halves with a space, so a collision would need an
       * address carrying a space to move the boundary -- and that is rejected
       * before hashing. The guarantee is therefore structural rather than
       * probabilistic, and this pins the premise it rests on: remove the
       * whitespace rejection and shorter-name-longer-address pairs start to
       * collide with their neighbours.
       */
      expect(registrationIdentity("Sharma", "arjun a@e.ff")).toBeNull()
      expect(key("Sharma", "arjun@e.ff")).not.toBe(key("Arjun Sharma", "e@e.ff"))
    })

    it("treats a hyphen as part of the name, not as whitespace", () => {
      expect(key("Rao-Singh", "rakesh@example.com"))
        .not.toBe(key("Rao Singh", "rakesh@example.com"))
    })
  })

  describe("refuses what it cannot key", () => {
    it.each([
      ["no at sign", "rakesh.example.com"],
      ["two at signs", "rakesh@@example.com"],
      ["interior space", "rak esh@example.com"],
      ["no domain dot", "rakesh@example"],
    ])("rejects an address with %s", (_reason, email) => {
      expect(registrationIdentity("Arjun Sharma", email)).toBeNull()
    })

    it("rejects a name that normalizes to nothing", () => {
      expect(registrationIdentity("   ", "rakesh@example.com")).toBeNull()
    })

    it("rejects a single-character name and one over eighty", () => {
      expect(registrationIdentity("A", "rakesh@example.com")).toBeNull()
      expect(registrationIdentity("A".repeat(81), "rakesh@example.com")).toBeNull()
    })

    it("keeps neither half readable in the key", () => {
      const identity = registrationIdentity("Arjun Sharma", "rakesh@example.com")!
      expect(identity.subjectKey).not.toContain("rakesh")
      expect(identity.subjectKey).not.toContain("arjun")
      expect(identity.subjectKey).toMatch(/^registration:[0-9a-f]{64}$/u)
    })
  })
})

describe("registration contact mobile", () => {
  it.each([
    ["plain digits", "9876543210"],
    ["country code", "+919876543210"],
    ["spaced", "+91 98765 43210"],
    ["hyphenated", "+91-98765-43210"],
  ])("accepts %s", (_shape, value) => {
    expect(normalizeRegistrationPhone(value)).not.toBeNull()
  })

  it.each([
    ["letters", "98765abcde"],
    ["too short", "1234567"],
    ["too long", "1234567890123456"],
    ["empty", "   "],
  ])("rejects %s", (_shape, value) => {
    expect(normalizeRegistrationPhone(value)).toBeNull()
  })
})

describe("registration date of birth", () => {
  const TODAY = "2026-09-01"

  it("accepts an ISO date in the past", () => {
    expect(validateRegistrationDateOfBirth("2014-03-11", TODAY)).toBe("2014-03-11")
  })

  it("accepts today", () => {
    expect(validateRegistrationDateOfBirth(TODAY, TODAY)).toBe(TODAY)
  })

  it.each([
    ["a day that does not exist", "2026-02-30"],
    ["no separators", "20140311"],
    ["a future date", "2027-01-01"],
    ["an implausible year", "1850-01-01"],
    ["empty", ""],
  ])("rejects %s", (_reason, value) => {
    expect(validateRegistrationDateOfBirth(value, TODAY)).toBeNull()
  })
})

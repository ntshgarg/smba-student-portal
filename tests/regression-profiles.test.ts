import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  createPlayerDefinitions,
  fixtureProfiles,
  resolveFixtureProfile,
} from "@/scripts/regression/profiles"

describe("deterministic academy fixture profiles", () => {
  it.each([
    ["demo", 40, 2],
    ["edge", 32, 3],
    ["stress", 100, 3],
  ] as const)("defines the %s academy contract", (key, players, pending) => {
    const profile = fixtureProfiles[key]
    const definitions = createPlayerDefinitions(profile)

    expect(definitions).toHaveLength(players)
    expect(profile.pendingPlayerNames).toHaveLength(pending)
    expect(path.dirname(profile.target)).toBe(path.resolve(process.cwd(), ".data"))
    expect(resolveFixtureProfile(key)).toBe(profile)
  })

  it.each(["demo", "edge"] as const)(
    "%s distributes lifecycle examples without emptying a cohort",
    (key) => {
      const definitions = createPlayerDefinitions(fixtureProfiles[key])
      const states = definitions.reduce<Record<string, number>>((counts, player) => ({
        ...counts,
        [player.finalState]: (counts[player.finalState] ?? 0) + 1,
      }), {})
      const activeCohorts = new Set(definitions
        .filter((player) => player.finalState === "active")
        .map((player) => `${player.level}:${player.batch}`))

      expect(states).toMatchObject({ active: definitions.length - 6, paused: 3, unassigned: 2, archived: 1 })
      expect(activeCohorts.size).toBe(8)
    },
  )

  it("keeps Stress large while representing supported academy lifecycle states", () => {
    const definitions = createPlayerDefinitions(fixtureProfiles.stress)
    const states = definitions.reduce<Record<string, number>>((counts, player) => ({
      ...counts,
      [player.finalState]: (counts[player.finalState] ?? 0) + 1,
    }), {})
    const activeCohorts = new Set(definitions
      .filter((player) => player.finalState === "active")
      .map((player) => `${player.level}:${player.batch}`))

    expect(states).toEqual({ active: 94, archived: 1, paused: 3, unassigned: 2 })
    expect(activeCohorts.size).toBe(8)
    expect(fixtureProfiles.stress.juniorCoaches).toEqual([
      { attendanceRate: 1, fullName: "Arun Kumar" },
      { attendanceRate: 0.75, fullName: "Meera Nair" },
    ])
  })
})

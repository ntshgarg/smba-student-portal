import path from "node:path"

import Database from "better-sqlite3"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  getActiveHomepageAnnouncement,
  getActivePlayerAnnouncement,
  listActiveHomepageAnnouncements,
  listActivePlayerAnnouncements,
  listCoachAnnouncements,
} from "@/lib/announcements/queries"
import {
  publishAnnouncement,
  setAnnouncementPinned,
  withdrawAnnouncement,
} from "@/lib/announcements/service"
import type { SmbaDatabase } from "@/lib/db/client"
import { INITIAL_COACH_ACCOUNT_ID, seedDatabase } from "@/lib/db/seed"
import * as schema from "@/lib/db/schema"

const HEAD_COACH_ID = INITIAL_COACH_ACCOUNT_ID
const PLAYER_ID = "10000000-0000-4000-8000-000000000001"
const JUNIOR_ID = "20000000-0000-4000-8000-000000000001"
const FIRST_ANNOUNCEMENT_ID = "30000000-0000-4000-8000-000000000001"
const SECOND_ANNOUNCEMENT_ID = "30000000-0000-4000-8000-000000000002"
const WITHDRAWAL_ID = "40000000-0000-4000-8000-000000000001"
const NOW = new Date("2026-08-09T10:00:00+05:30")

let sqlite: Database.Database
let database: SmbaDatabase

function addApprovedAccount(input: {
  accessLevel?: "junior_coach"
  fullName: string
  id: string
  role: "coach" | "player"
  serial: number
}) {
  database.insert(schema.accounts).values({
    id: input.id,
    fullName: input.fullName,
    normalizedName: input.fullName.toLocaleLowerCase("en-IN"),
    requestedRole: input.role,
    role: input.role,
    approvalStatus: "approved",
    approvedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  }).run()
  database.insert(schema.academyIdAllocations).values({
    serial: input.serial,
    accountId: input.id,
    createdAt: NOW,
  }).run()
  if (input.role === "coach") {
    database.insert(schema.coachProfiles).values({
      accountId: input.id,
      accessLevel: input.accessLevel ?? "junior_coach",
      joinedOn: "2026-08-01",
      createdAt: NOW,
      updatedAt: NOW,
    }).run()
  }
}

beforeEach(() => {
  sqlite = new Database(":memory:")
  sqlite.pragma("foreign_keys = ON")
  database = drizzle(sqlite, { schema }) as SmbaDatabase
  migrate(database, { migrationsFolder: path.resolve(process.cwd(), "drizzle") })
  seedDatabase(database)
  addApprovedAccount({
    fullName: "Announcement Player",
    id: PLAYER_ID,
    role: "player",
    serial: 20,
  })
  addApprovedAccount({
    accessLevel: "junior_coach",
    fullName: "Junior Coach",
    id: JUNIOR_ID,
    role: "coach",
    serial: 21,
  })
})

afterEach(() => {
  sqlite.close()
})

describe("announcement publication", () => {
  it("publishes all facts atomically and reuses only an exact publication request", async () => {
    const input = {
      title: "  Sunday training update  ",
      content: "Court maintenance is complete.\r\nTraining begins on time.",
      channels: ["player_dashboard", "homepage", "homepage"] as const,
      pinned: true,
      expiresOn: "2026-08-09",
      publicationKey: "11111111-1111-4111-8111-111111111111",
    }
    const published = await publishAnnouncement(input, {
      coachId: HEAD_COACH_ID,
      createId: () => FIRST_ANNOUNCEMENT_ID,
      database,
      now: NOW,
    })
    expect(published).toMatchObject({
      reusedPublication: false,
      announcement: {
        audience: "everyone",
        channels: ["homepage", "player_dashboard"],
        content: "Court maintenance is complete.\nTraining begins on time.",
        expiresOn: "2026-08-09",
        id: FIRST_ANNOUNCEMENT_ID,
        pinned: true,
        status: "active",
        title: "Sunday training update",
      },
    })
    expect(database.select().from(schema.broadcastAudienceTargets).all()).toHaveLength(1)
    expect(database.select().from(schema.broadcastChannels).all()).toHaveLength(2)

    const retry = await publishAnnouncement(input, {
      coachId: HEAD_COACH_ID,
      createId: () => SECOND_ANNOUNCEMENT_ID,
      database,
      now: new Date("2026-08-09T11:00:00+05:30"),
    })
    expect(retry.reusedPublication).toBe(true)
    expect(retry.announcement.id).toBe(FIRST_ANNOUNCEMENT_ID)
    expect(database.select().from(schema.broadcasts).all()).toHaveLength(1)

    await expect(publishAnnouncement({ ...input, title: "Different title" }, {
      coachId: HEAD_COACH_ID,
      database,
      now: NOW,
    })).rejects.toMatchObject({ code: "PUBLICATION_CONFLICT" })
  })

  it("validates content, channels, expiry and head-admin authorization before writing", async () => {
    const valid = {
      title: "Training update",
      content: "Training begins on time.",
      channels: ["homepage"] as const,
      publicationKey: "22222222-2222-4222-8222-222222222222",
    }
    const invalid = [
      { ...valid, title: "" },
      { ...valid, content: "" },
      { ...valid, channels: [] },
      { ...valid, expiresOn: "2026-08-08" },
      { ...valid, expiresOn: 42 as never },
      { ...valid, publicationKey: "not-a-uuid" },
    ]
    for (const input of invalid) {
      await expect(publishAnnouncement(input, {
        coachId: HEAD_COACH_ID,
        database,
        now: NOW,
      })).rejects.toMatchObject({ code: "INVALID_INPUT" })
    }
    await expect(publishAnnouncement(valid, {
      coachId: JUNIOR_ID,
      database,
      now: NOW,
    })).rejects.toThrow("Head coach access")
    expect(database.select().from(schema.broadcasts).all()).toHaveLength(0)
  })
})

describe("announcement presentation and withdrawal", () => {
  it("uses optimistic pin revisions and preserves publication facts", async () => {
    const published = await publishAnnouncement({
      title: "Pinned notice",
      content: "This content remains immutable.",
      channels: ["homepage"],
      publicationKey: "33333333-3333-4333-8333-333333333333",
    }, {
      coachId: HEAD_COACH_ID,
      createId: () => FIRST_ANNOUNCEMENT_ID,
      database,
      now: NOW,
    })
    const pinned = await setAnnouncementPinned({
      announcementId: published.announcement.id,
      pinned: true,
      expectedPresentationRevision: 0,
    }, { coachId: HEAD_COACH_ID, database, now: NOW })
    expect(pinned).toMatchObject({
      reused: false,
      announcement: { pinned: true, presentationRevision: 1 },
    })
    const retry = await setAnnouncementPinned({
      announcementId: published.announcement.id,
      pinned: true,
      expectedPresentationRevision: 0,
    }, { coachId: HEAD_COACH_ID, database, now: NOW })
    expect(retry.reused).toBe(true)
    await expect(setAnnouncementPinned({
      announcementId: published.announcement.id,
      pinned: false,
      expectedPresentationRevision: 0,
    }, { coachId: HEAD_COACH_ID, database, now: NOW })).rejects.toMatchObject({
      code: "REVISION_CONFLICT",
    })
    expect(database.select().from(schema.broadcasts)
      .where(eq(schema.broadcasts.id, published.announcement.id)).get()).toMatchObject({
      title: "Pinned notice",
      content: "This content remains immutable.",
      pinned: true,
      presentationRevision: 1,
    })
  })

  it("withdraws once with a private reason and removes the announcement from active surfaces", async () => {
    const published = await publishAnnouncement({
      title: "Event notice",
      content: "The event begins at 9 am.",
      channels: ["homepage", "player_dashboard"],
      publicationKey: "44444444-4444-4444-8444-444444444444",
    }, {
      coachId: HEAD_COACH_ID,
      createId: () => FIRST_ANNOUNCEMENT_ID,
      database,
      now: NOW,
    })
    const withdrawn = await withdrawAnnouncement({
      announcementId: published.announcement.id,
      reason: "  Event cancelled  ",
    }, {
      coachId: HEAD_COACH_ID,
      createId: () => WITHDRAWAL_ID,
      database,
      now: NOW,
    })
    expect(withdrawn.announcement).toMatchObject({
      status: "withdrawn",
      withdrawal: { reason: "Event cancelled" },
    })
    expect(listActiveHomepageAnnouncements({ database, now: NOW })).toEqual([])
    expect(listActivePlayerAnnouncements(PLAYER_ID, { database, now: NOW })).toEqual([])
    const archive = listCoachAnnouncements({}, {
      coachId: HEAD_COACH_ID,
      database,
      now: NOW,
    })
    expect(archive[0]).toMatchObject({
      id: FIRST_ANNOUNCEMENT_ID,
      status: "withdrawn",
      withdrawal: { reason: "Event cancelled" },
    })
    await expect(withdrawAnnouncement({
      announcementId: published.announcement.id,
      reason: "Incorrect timing",
    }, { coachId: HEAD_COACH_ID, database, now: NOW })).rejects.toMatchObject({
      code: "ALREADY_WITHDRAWN",
    })
  })
})

describe("announcement audience queries", () => {
  it("isolates channels, keeps expiry inclusive, and protects player details", async () => {
    await publishAnnouncement({
      title: "Homepage only",
      content: "Visible only on the academy homepage.",
      channels: ["homepage"],
      expiresOn: "2026-08-09",
      publicationKey: "55555555-5555-4555-8555-555555555555",
    }, {
      coachId: HEAD_COACH_ID,
      createId: () => FIRST_ANNOUNCEMENT_ID,
      database,
      now: NOW,
    })
    await publishAnnouncement({
      title: "Player only",
      content: "Visible only to approved players.",
      channels: ["player_dashboard"],
      publicationKey: "66666666-6666-4666-8666-666666666666",
    }, {
      coachId: HEAD_COACH_ID,
      createId: () => SECOND_ANNOUNCEMENT_ID,
      database,
      now: NOW,
    })

    expect(listActiveHomepageAnnouncements({ database, now: NOW })).toEqual([
      expect.objectContaining({ id: FIRST_ANNOUNCEMENT_ID, title: "Homepage only" }),
    ])
    expect(getActiveHomepageAnnouncement(SECOND_ANNOUNCEMENT_ID, { database, now: NOW }))
      .toBeNull()
    expect(listActivePlayerAnnouncements(PLAYER_ID, { database, now: NOW })).toEqual([
      expect.objectContaining({ id: SECOND_ANNOUNCEMENT_ID, isNew: true }),
    ])
    expect(getActivePlayerAnnouncement(PLAYER_ID, SECOND_ANNOUNCEMENT_ID, {
      database,
      now: NOW,
    })).toMatchObject({ content: "Visible only to approved players." })

    database.update(schema.accounts).set({ archivedAt: NOW })
      .where(eq(schema.accounts.id, PLAYER_ID)).run()
    expect(listActivePlayerAnnouncements(PLAYER_ID, { database, now: NOW })).toEqual([])
    expect(getActivePlayerAnnouncement(PLAYER_ID, SECOND_ANNOUNCEMENT_ID, {
      database,
      now: NOW,
    })).toBeNull()

    const tomorrow = new Date("2026-08-10T00:01:00+05:30")
    expect(listActiveHomepageAnnouncements({ database, now: tomorrow })).toEqual([])
  })
})

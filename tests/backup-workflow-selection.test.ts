import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"

import { afterEach, describe, expect, it, vi } from "vitest"

const SCHEDULED_WORKFLOW = `name: Encrypted production backup

on:
  schedule:
    - cron: "0 3 * * *"
  workflow_dispatch:
`

const UNSCHEDULED_WORKFLOW = `name: Encrypted production backup

on:
  # The nightly schedule is off; see the workflow for why.
  #   - cron: "0 3 * * *"
  workflow_dispatch:
`

type StoredBackup = {
  asset: { id: number, name: string, size: number } | null
  complete: boolean
  createdAt: string | null
  id: number
  name: string
}

type Store = { owner: string, repo: string }

const require = createRequire(import.meta.url)
const backupStore = require("../.github/scripts/backup-store.js") as {
  NO_BACKUP_MESSAGE: string
  assertPrivateStore: (input: Record<string, unknown>) => Promise<unknown>
  backupsToPrune: (backups: StoredBackup[], now: Date) => StoredBackup[]
  downloadStoredBackup: (input: Record<string, unknown>) => Promise<{ file: string }>
  listStoredBackups: (input: Record<string, unknown>) => Promise<StoredBackup[]>
  newestCompleteBackup: (backups: StoredBackup[]) => StoredBackup | null
  parseStoreRepository: (value: string) => Store
  pruneStoredBackups: (input: Record<string, unknown>) => Promise<string[]>
  requireRecentBackup: (backup: StoredBackup | null, now: Date) => number
  requireStoreToken: (tokenIsSet: boolean) => void
  selectBackup: (backups: StoredBackup[], requested?: string) => StoredBackup
  storeBackup: (input: Record<string, unknown>) => Promise<{ name: string, size: number }>
}
const checkBackupFreshness = require("../.github/scripts/check-backup-freshness.js") as ((
  input: Record<string, unknown>
) => Promise<Record<string, unknown>>) & {
  backupScheduleIsEnabled: (source: string) => boolean
}
const { backupScheduleIsEnabled } = checkBackupFreshness

const STORE: Store = { owner: "owner", repo: "smba-backups" }
const PUBLIC_REPOSITORY = "owner/smba-student-portal"
const NOW = new Date("2026-11-14T00:00:00Z")
const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { force: true, recursive: true })
})

function release(id: number, createdAt: string, overrides: Record<string, unknown> = {}) {
  const name = `smba-backup-${createdAt.replace(/[:.]/gu, "-")}`
  return {
    assets: [{ id: id * 10, name: `${name}.tar.gz.gpg`, size: 2048, state: "uploaded" }],
    body: JSON.stringify({ createdAt }),
    draft: true,
    id,
    name,
    ...overrides,
  }
}

function storeMock({
  releases = [] as unknown[],
  repository = { full_name: "owner/smba-backups", private: true, visibility: "private" } as Record<string, unknown>,
  uploadFails = false,
} = {}) {
  return {
    paginate: vi.fn(async (list: () => Promise<{ data: unknown[] }>) => (await list()).data),
    rest: {
      repos: {
        createRelease: vi.fn(async (input: Record<string, unknown>) => ({ data: { id: 900, ...input } })),
        deleteRelease: vi.fn(async () => ({ data: {} })),
        get: vi.fn(async () => ({ data: repository })),
        getReleaseAsset: vi.fn(),
        listReleases: vi.fn(async () => ({ data: releases })),
        uploadReleaseAsset: vi.fn(async ({ data }: { data: Buffer }) => {
          if (uploadFails) throw new Error("network went away")
          return { data: { size: data.length, state: "uploaded" } }
        }),
      },
    },
  }
}

function encryptedFile(contents = "encrypted backup bytes") {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-store-test-"))
  directories.push(directory)
  const file = path.join(directory, "smba-production-backup.tar.gz.gpg")
  fs.writeFileSync(file, contents)
  return { directory, file }
}

/*
 * The backups hold every child's record, so the one thing this module must
 * never do is put one somewhere a stranger can download it. This repository is
 * public; a store that is public, or that is this repository, is refused before
 * anything is uploaded.
 */
describe("the private backup store", () => {
  it("refuses a store that is not private, and uploads nothing", async () => {
    const github = storeMock({ repository: { full_name: "owner/smba-backups", private: false, visibility: "public" } })
    const { file } = encryptedFile()

    await expect(backupStore.storeBackup({
      filePath: file,
      github,
      now: NOW,
      publicRepository: PUBLIC_REPOSITORY,
      sourceRun: "1-1",
      store: STORE,
    })).rejects.toThrow(/is not private/u)
    expect(github.rest.repos.createRelease).not.toHaveBeenCalled()
    expect(github.rest.repos.uploadReleaseAsset).not.toHaveBeenCalled()
  })

  it("refuses to use this public repository as its own store", async () => {
    await expect(backupStore.assertPrivateStore({
      github: storeMock({ repository: { full_name: PUBLIC_REPOSITORY, private: true } }),
      publicRepository: PUBLIC_REPOSITORY,
      store: backupStore.parseStoreRepository(PUBLIC_REPOSITORY),
    })).rejects.toThrow(/separate private repository/u)
  })

  it("explains plainly when the store cannot be opened", async () => {
    const github = storeMock()
    github.rest.repos.get.mockRejectedValueOnce(new Error("Not Found"))

    await expect(backupStore.assertPrivateStore({ github, publicRepository: PUBLIC_REPOSITORY, store: STORE }))
      .rejects.toThrow(/could not be opened with SMBA_BACKUP_STORE_TOKEN/u)
    expect(() => backupStore.parseStoreRepository("not a repository")).toThrow(/owner\/repository/u)
  })

  it("stores the encrypted file as a draft with its time", async () => {
    const github = storeMock()
    const { file } = encryptedFile("locked bytes")

    const stored = await backupStore.storeBackup({
      filePath: file,
      github,
      now: new Date("2026-11-13T21:17:04.512Z"),
      publicRepository: PUBLIC_REPOSITORY,
      sourceRun: "77-1",
      store: STORE,
    })

    expect(stored).toEqual({
      name: "smba-backup-2026-11-13T21-17-04-512Z",
      size: "locked bytes".length,
    })
    const created = github.rest.repos.createRelease.mock.calls[0][0]
    expect(created).toMatchObject({ draft: true, owner: "owner", repo: "smba-backups" })
    expect(JSON.parse(String(created.body))).toEqual({
      createdAt: "2026-11-13T21:17:04.512Z",
      sourceRun: "77-1",
    })
    expect(github.rest.repos.uploadReleaseAsset.mock.calls[0][0])
      .toMatchObject({ name: "smba-backup-2026-11-13T21-17-04-512Z.tar.gz.gpg", release_id: 900 })
  })

  it("removes the half-made entry when the upload fails", async () => {
    const github = storeMock({ uploadFails: true })
    const { file } = encryptedFile()

    await expect(backupStore.storeBackup({
      filePath: file,
      github,
      now: NOW,
      publicRepository: PUBLIC_REPOSITORY,
      sourceRun: "1-1",
      store: STORE,
    })).rejects.toThrow(/could not be uploaded/u)
    expect(github.rest.repos.deleteRelease).toHaveBeenCalledWith(expect.objectContaining({ release_id: 900 }))
  })
})

describe("finding and keeping stored backups", () => {
  it("lists only complete backups as restorable, newest first, by the time in their notes", async () => {
    const backups = await backupStore.listStoredBackups({
      github: storeMock({
        releases: [
          release(1, "2026-11-11T21:17:00.000Z"),
          release(2, "2026-11-13T21:17:00.000Z"),
          // An upload that failed half-way: no file attached.
          release(3, "2026-11-13T23:00:00.000Z", { assets: [] }),
          { assets: [], body: "", id: 4, name: "v1.0.0" },
        ],
      }),
      store: STORE,
    })

    expect(backups.map((backup) => [backup.id, backup.complete])).toEqual([[3, false], [2, true], [1, true]])
    expect(backupStore.newestCompleteBackup(backups)?.id).toBe(2)
    expect(backupStore.selectBackup(backups).id).toBe(2)
    expect(backupStore.selectBackup(backups, backups[2].name).id).toBe(1)
    expect(() => backupStore.selectBackup(backups, backups[0].name)).toThrow(/no complete stored backup/u)
  })

  it("keeps 30 days, and never deletes the newest complete backup however old", async () => {
    const recent = (await backupStore.listStoredBackups({
      github: storeMock({ releases: [
        release(1, "2026-10-01T21:17:00.000Z"),
        release(2, "2026-10-20T21:17:00.000Z"),
        release(3, "2026-11-13T21:17:00.000Z"),
      ] }),
      store: STORE,
    }))
    expect(backupStore.backupsToPrune(recent, NOW).map((backup) => backup.id)).toEqual([1])

    // A month of failed nights: the last good copy is old, and kept.
    const stale = recent.filter((backup) => backup.id === 1)
    expect(backupStore.backupsToPrune(stale, NOW)).toEqual([])

    const github = storeMock({ releases: [release(1, "2026-10-01T21:17:00.000Z"), release(3, "2026-11-13T21:17:00.000Z")] })
    await expect(backupStore.pruneStoredBackups({ github, now: NOW, store: STORE }))
      .resolves.toEqual([release(1, "2026-10-01T21:17:00.000Z").name])
    expect(github.rest.repos.deleteRelease).toHaveBeenCalledTimes(1)
  })

  it("says plainly that there is no backup at all", () => {
    expect(() => backupStore.selectBackup([])).toThrow(/Beyond Turso's one-day rewind/u)
    expect(() => backupStore.requireRecentBackup(null, NOW)).toThrow(/No backup is stored/u)
    expect(() => backupStore.requireStoreToken(false)).toThrow(/No private backup store is set up/u)
  })

  it("only accepts a backup from the last 30 hours before the academy is emptied", async () => {
    const [newest] = await backupStore.listStoredBackups({
      github: storeMock({ releases: [release(1, "2026-11-12T21:17:00.000Z")] }),
      store: STORE,
    })
    expect(backupStore.requireRecentBackup(newest, new Date("2026-11-13T09:17:00Z"))).toBe(12)
    expect(() => backupStore.requireRecentBackup(newest, new Date("2026-11-14T05:17:00Z")))
      .toThrow(/32 hours ago\. Run "Encrypted production backup" by hand/u)
    // 30 hours and 45 minutes is not "less than 30 hours", whatever the rounding.
    expect(() => backupStore.requireRecentBackup(newest, new Date("2026-11-14T04:02:00Z")))
      .toThrow(/30 hours ago/u)
  })

  it("fetches a stored backup into a private file", async () => {
    const bytes = Buffer.from("the stored ciphertext")
    const [backup] = await backupStore.listStoredBackups({
      github: storeMock({ releases: [release(1, "2026-11-13T21:17:00.000Z")] }),
      store: STORE,
    })
    const { directory } = encryptedFile()

    const github = storeMock()
    github.rest.repos.getReleaseAsset.mockResolvedValueOnce({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) })
    const fetched = await backupStore.downloadStoredBackup({ backup, directory: path.join(directory, "download"), github, store: STORE })
    expect(fs.readFileSync(fetched.file)).toEqual(bytes)
    expect((fs.statSync(fetched.file).mode & 0o777).toString(8)).toBe("600")
  })
})

function trustedRun(overrides: Record<string, unknown> = {}) {
  return {
    conclusion: "success",
    created_at: "2027-01-22T01:00:00Z",
    head_branch: "main",
    head_repository: { full_name: "owner/repo" },
    id: 101,
    name: "Encrypted production backup",
    run_attempt: 2,
    updated_at: "2027-01-22T01:05:00Z",
    ...overrides,
  }
}

function runsMock({ backupRuns = [trustedRun()], restoreRuns = [trustedRun({
  id: 202,
  name: "Encrypted backup restore verification",
})] } = {}) {
  return {
    rest: {
      actions: {
        listWorkflowRuns: vi.fn(async ({ workflow_id }: { workflow_id: string }) => ({
          data: { workflow_runs: workflow_id.includes("restore") ? restoreRuns : backupRuns },
        })),
      },
    },
  }
}

describe("backup freshness monitor", () => {
  it("requires a backup within 30 hours and a restore check within 35 days", async () => {
    const result = await checkBackupFreshness({
      backupWorkflowSource: SCHEDULED_WORKFLOW,
      defaultBranch: "main",
      github: runsMock(),
      now: new Date("2027-01-23T00:00:00Z"),
      owner: "owner",
      repo: "repo",
    })
    expect(result).toEqual({ backupRunId: 101, muted: false, restoreRunId: 202 })

    await expect(checkBackupFreshness({
      backupWorkflowSource: SCHEDULED_WORKFLOW,
      defaultBranch: "main",
      github: runsMock({ backupRuns: [trustedRun({ created_at: "2027-01-19T23:55:00Z", updated_at: "2027-01-20T00:00:00Z" })] }),
      now: new Date("2027-01-23T00:00:00Z"),
      owner: "owner",
      repo: "repo",
    })).rejects.toThrow("more than 30 hours old")
  })

  /*
   * Before the store is set up nothing is ever stored. Every one of those
   * nights fails "Encrypted production backup" itself, and that failure is the
   * alert; the monitor says the same in plain words without failing every half
   * hour on top of it.
   */
  it("says what having no backup means, rather than sounding routine", async () => {
    const result = await checkBackupFreshness({
      backupWorkflowSource: SCHEDULED_WORKFLOW,
      defaultBranch: "main",
      github: runsMock({ backupRuns: [trustedRun({ conclusion: "failure" })] }),
      now: new Date("2027-01-23T00:00:00Z"),
      owner: "owner",
      repo: "repo",
    })
    expect(result).toMatchObject({ backupRunId: null, muted: true })
    expect(result.message).toMatch(/Beyond Turso's one-day rewind, the academy has no copy/u)
  })

  /*
   * GitHub still lists the successful runs from before the private store: the
   * fifteen public-artifact backups up to 3 Sep 2026 and restore checks of
   * them up to 1 Oct 2026. Those copies are gone, so the monitor must not
   * treat them as backups or restore checks.
   */
  it("ignores the runs from before the private store existed", async () => {
    const artifactEraBackup = trustedRun({
      created_at: "2026-09-03T21:17:00Z",
      id: 15,
      updated_at: "2026-09-03T21:25:00Z",
    })
    const artifactEraRestore = trustedRun({
      created_at: "2026-10-01T04:47:00Z",
      id: 16,
      name: "Encrypted backup restore verification",
      updated_at: "2026-10-01T05:10:00Z",
    })

    // The store is not set up yet: every night fails, and the monitor only warns.
    const beforeStore = await checkBackupFreshness({
      backupWorkflowSource: SCHEDULED_WORKFLOW,
      defaultBranch: "main",
      github: runsMock({
        backupRuns: [trustedRun({ conclusion: "failure", created_at: "2026-11-20T21:17:00Z" }), artifactEraBackup],
        restoreRuns: [artifactEraRestore],
      }),
      now: new Date("2026-11-21T00:00:00Z"),
      owner: "owner",
      repo: "repo",
    })
    expect(beforeStore).toMatchObject({ backupRunId: null, muted: true })
    expect(beforeStore.message).toMatch(/No backup has been stored yet/u)

    // The first stored backup lands: the old restore check does not count,
    // and the first real one is not due for 35 days.
    const firstStored = trustedRun({
      created_at: "2026-11-21T21:17:00Z",
      id: 300,
      updated_at: "2026-11-21T21:25:00Z",
    })
    const afterStore = await checkBackupFreshness({
      backupWorkflowSource: SCHEDULED_WORKFLOW,
      defaultBranch: "main",
      github: runsMock({ backupRuns: [firstStored, artifactEraBackup], restoreRuns: [artifactEraRestore] }),
      now: new Date("2026-11-22T00:00:00Z"),
      owner: "owner",
      repo: "repo",
    })
    expect(afterStore).toMatchObject({ backupRunId: 300, muted: false, restoreRunId: null })

    // A restore check run before the first stored backup cannot have checked one.
    const earlyRestore = trustedRun({ created_at: "2026-11-15T04:47:00Z", id: 301, updated_at: "2026-11-15T05:00:00Z" })
    await expect(checkBackupFreshness({
      backupWorkflowSource: SCHEDULED_WORKFLOW,
      defaultBranch: "main",
      github: runsMock({ backupRuns: [firstStored], restoreRuns: [earlyRestore] }),
      now: new Date("2026-11-22T00:00:00Z"),
      owner: "owner",
      repo: "repo",
    })).resolves.toMatchObject({ restoreRunId: null })
  })

  it("waits for the first monthly restore check, then insists on it", async () => {
    // Backups began a week ago: the first restore check is not due yet.
    const early = await checkBackupFreshness({
      backupWorkflowSource: SCHEDULED_WORKFLOW,
      defaultBranch: "main",
      github: runsMock({
        backupRuns: [trustedRun(), trustedRun({ created_at: "2027-01-15T01:00:00Z", id: 90, updated_at: "2027-01-15T01:05:00Z" })],
        restoreRuns: [],
      }),
      now: new Date("2027-01-23T00:00:00Z"),
      owner: "owner",
      repo: "repo",
    })
    expect(early).toMatchObject({ backupRunId: 101, muted: false, restoreRunId: null })
    expect(early.message).toMatch(/runs on the 1st of the month/u)

    // Six weeks of backups and still no successful restore check.
    await expect(checkBackupFreshness({
      backupWorkflowSource: SCHEDULED_WORKFLOW,
      defaultBranch: "main",
      github: runsMock({
        backupRuns: [trustedRun(), trustedRun({ created_at: "2026-11-29T01:00:00Z", id: 60, updated_at: "2026-11-29T01:05:00Z" })],
        restoreRuns: [],
      }),
      now: new Date("2027-01-23T00:00:00Z"),
      owner: "owner",
      repo: "repo",
    })).rejects.toThrow(/none has been restored and checked/u)
  })
})

/*
 * The 30-hour gate is muted only while the nightly backup schedule is switched
 * off on purpose, and it un-mutes itself when the schedule comes back. The
 * head coach decided on 13 Nov 2026 that backups run nightly, so the live file
 * must be scheduled -- and therefore watched.
 */
describe("backup freshness and the nightly schedule", () => {
  it("reads the schedule out of the workflow, comments and all", () => {
    expect(backupScheduleIsEnabled(SCHEDULED_WORKFLOW)).toBe(true)
    expect(backupScheduleIsEnabled(UNSCHEDULED_WORKFLOW)).toBe(false)
    expect(backupScheduleIsEnabled('on:\n  # schedule:\n  #   - cron: "0 3 * * *"\n  workflow_dispatch:\n'))
      .toBe(false)
    // A `schedule:` key belonging to some later top-level block is not this one.
    expect(backupScheduleIsEnabled("on:\n  workflow_dispatch:\njobs:\n  schedule:\n")).toBe(false)
  })

  it("passes with the backup's age instead of failing while the schedule is off", async () => {
    await expect(checkBackupFreshness({
      backupWorkflowSource: UNSCHEDULED_WORKFLOW,
      defaultBranch: "main",
      github: runsMock({ backupRuns: [trustedRun({ created_at: "2027-01-19T23:55:00Z", updated_at: "2027-01-20T00:00:00Z" })] }),
      now: new Date("2027-01-23T00:00:00Z"),
      owner: "owner",
      repo: "repo",
    })).resolves.toEqual({ backupAgeHours: 72, backupRunId: 101, muted: true })
  })

  it("runs every night, so the monitor watches it", () => {
    const live = fs.readFileSync(
      new URL("../.github/workflows/encrypted-production-backup.yml", import.meta.url),
      "utf8",
    )
    expect(backupScheduleIsEnabled(live)).toBe(true)
  })
})

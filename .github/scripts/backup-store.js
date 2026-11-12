"use strict"

/*
 * Where the nightly encrypted backups are kept, and how they are found again.
 *
 * Not in this repository's workflow artifacts. This repository is public, and
 * any GitHub account can download a public repository's artifacts -- which is
 * how fifteen encrypted copies of the academy, children's records included,
 * came to be downloadable by anyone until they were found and deleted. So the
 * backups live in a separate PRIVATE repository the owner creates, as files
 * attached to draft releases there. Reading them needs an account or token the
 * owner granted, and revoking that token or removing a collaborator takes the
 * access away again.
 *
 * One draft release per backup, holding exactly one encrypted file. Its notes
 * record when the backup was made and the file's SHA-256, so the restore check
 * can prove it fetched the same bytes that were stored. Drafts are used because
 * they create no git tag, so deleting one after 30 days leaves nothing behind.
 * A release's own created_at is the date of the commit it points at, not when
 * it was drafted, so the time is read from the notes instead.
 */

// actions/github-script loads this file with require(), so it is CommonJS and
// reaches Node's own modules the same way.
/* eslint-disable @typescript-eslint/no-require-imports */
const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
/* eslint-enable @typescript-eslint/no-require-imports */

const BACKUP_PREFIX = "smba-backup-"
const BACKUP_FILE_PATTERN = /^smba-backup-[0-9TZ-]+\.tar\.gz\.gpg$/u
const RETENTION_DAYS = 30
const RECENT_BACKUP_HOURS = 30
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

const SETUP_GUIDE = 'docs/PRODUCTION-OPERATIONS.md, "Scheduled encrypted backups"'
const NO_BACKUP_MESSAGE = "No backup is stored. Beyond Turso's one-day rewind, the academy has no copy "
  + "of its records that could be restored. Finish setting up the private backup store "
  + `(${SETUP_GUIDE}), then run "Encrypted production backup".`

function parseStoreRepository(value) {
  const match = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/u.exec(String(value ?? "").trim())
  if (!match) {
    throw new Error(
      "The backup store must be named as owner/repository, for example ntshgarg/smba-backups. "
      + `See ${SETUP_GUIDE}.`,
    )
  }
  return { owner: match[1], repo: match[2] }
}

function storeName(store) {
  return `${store.owner}/${store.repo}`
}

/**
 * Refuses unless the store is a separate repository that is private. Checked
 * before every upload, so making the store public, or pointing the setting at
 * the wrong repository, stops the next backup instead of publishing it.
 */
async function assertPrivateStore({ github, publicRepository, store }) {
  let repository
  try {
    repository = (await github.rest.repos.get({ owner: store.owner, repo: store.repo })).data
  } catch {
    throw new Error(
      `The backup store ${storeName(store)} could not be opened with SMBA_BACKUP_STORE_TOKEN. `
      + `Check that the repository exists and that the token was given access to it. See ${SETUP_GUIDE}.`,
    )
  }
  if (String(repository.full_name).toLowerCase() === String(publicRepository).toLowerCase()) {
    throw new Error(
      `The backup store must be a separate private repository, not ${publicRepository} itself. `
      + "Nothing was stored.",
    )
  }
  if (repository.private !== true || repository.visibility === "public") {
    throw new Error(
      `The backup store ${storeName(store)} is not private. Backups hold children's records and `
      + "sign-in details, so nothing is stored anywhere a stranger could download it. Make the "
      + "repository private, then run the backup again.",
    )
  }
  return repository
}

function readNotes(body) {
  try {
    const notes = JSON.parse(body ?? "")
    return notes && typeof notes === "object" ? notes : {}
  } catch {
    return {}
  }
}

/**
 * The store's view of one release. `complete` is false for anything that is
 * not exactly one uploaded encrypted file with a recorded time and checksum --
 * the leftovers of an upload that failed half-way, say. Those are never
 * restored from, and are pruned like any other old entry.
 */
function describeRelease(release) {
  if (!String(release?.name ?? "").startsWith(BACKUP_PREFIX)) return null
  const notes = readNotes(release.body)
  const createdAt = Date.parse(notes.createdAt)
  const assets = Array.isArray(release.assets) ? release.assets : []
  const asset = assets.length === 1 ? assets[0] : null
  const complete = Number.isFinite(createdAt)
    && /^[a-f0-9]{64}$/u.test(String(notes.ciphertextSha256 ?? ""))
    && asset !== null
    && asset.state === "uploaded"
    && BACKUP_FILE_PATTERN.test(String(asset.name ?? ""))
    && Number(asset.size) > 0
  return {
    asset: asset ? { id: asset.id, name: asset.name, size: Number(asset.size) } : null,
    complete,
    createdAt: Number.isFinite(createdAt) ? new Date(createdAt).toISOString() : null,
    id: release.id,
    name: release.name,
    sha256: complete ? notes.ciphertextSha256 : null,
  }
}

async function listReleases({ github, store }) {
  const parameters = { owner: store.owner, per_page: 100, repo: store.repo }
  if (typeof github.paginate === "function") {
    return github.paginate(github.rest.repos.listReleases, parameters)
  }
  return (await github.rest.repos.listReleases(parameters)).data
}

/** Every backup in the store, newest first. */
async function listStoredBackups({ github, store }) {
  const releases = await listReleases({ github, store })
  return releases
    .map(describeRelease)
    .filter(Boolean)
    .sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")))
}

function newestCompleteBackup(backups) {
  return backups.find((backup) => backup.complete) ?? null
}

/**
 * The backups past the 30-day limit. The newest complete backup is never one
 * of them, however old: if the nightly job has been failing for a month, the
 * last good copy is the one thing that must not be thrown away.
 */
function backupsToPrune(backups, now, retentionDays = RETENTION_DAYS) {
  const keep = newestCompleteBackup(backups)
  const cutoff = now.getTime() - retentionDays * DAY_MS
  return backups.filter((backup) => backup !== keep
    && (backup.createdAt === null || Date.parse(backup.createdAt) < cutoff))
}

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex")
}

async function storeBackup({ filePath, github, now = new Date(), publicRepository, sourceRun, store }) {
  await assertPrivateStore({ github, publicRepository, store })
  const data = fs.readFileSync(filePath)
  if (!data.length) throw new Error("The encrypted backup is empty. Nothing was stored.")
  const name = `${BACKUP_PREFIX}${now.toISOString().replace(/[:.]/gu, "-")}`
  const ciphertextSha256 = sha256(data)
  const release = (await github.rest.repos.createRelease({
    body: JSON.stringify({ ciphertextSha256, createdAt: now.toISOString(), sourceRun }, null, 2),
    draft: true,
    name,
    owner: store.owner,
    repo: store.repo,
    tag_name: name,
  })).data
  try {
    const asset = (await github.rest.repos.uploadReleaseAsset({
      data,
      headers: { "content-length": data.length, "content-type": "application/octet-stream" },
      name: `${name}.tar.gz.gpg`,
      owner: store.owner,
      release_id: release.id,
      repo: store.repo,
    })).data
    if (Number(asset.size) !== data.length) throw new Error("The stored file is not the full backup.")
  } catch {
    await github.rest.repos.deleteRelease({ owner: store.owner, release_id: release.id, repo: store.repo })
      .catch(() => undefined)
    throw new Error(`The encrypted backup could not be uploaded to ${storeName(store)}. Nothing was kept.`)
  }
  return { name, sha256: ciphertextSha256, size: data.length }
}

async function pruneStoredBackups({ github, now = new Date(), store }) {
  const pruned = backupsToPrune(await listStoredBackups({ github, store }), now)
  for (const backup of pruned) {
    await github.rest.repos.deleteRelease({ owner: store.owner, release_id: backup.id, repo: store.repo })
  }
  return pruned.map((backup) => backup.name)
}

function selectBackup(backups, requestedName) {
  const requested = String(requestedName ?? "").trim()
  if (requested) {
    const match = backups.find((backup) => backup.name === requested)
    if (!match?.complete) {
      throw new Error(`There is no complete stored backup called ${requested}.`)
    }
    return match
  }
  const newest = newestCompleteBackup(backups)
  if (!newest) throw new Error(NO_BACKUP_MESSAGE)
  return newest
}

/**
 * Throws, in words the person running the workflow can act on, unless the
 * newest backup is less than 30 hours old: last night's, or one just run by
 * hand. Returns its age in whole hours.
 */
function requireRecentBackup(backup, now, maxHours = RECENT_BACKUP_HOURS) {
  if (!backup) throw new Error(NO_BACKUP_MESSAGE)
  const ageHours = Math.floor((now.getTime() - Date.parse(backup.createdAt)) / HOUR_MS)
  if (!(ageHours <= maxHours)) {
    throw new Error(
      `The newest stored backup is from ${backup.createdAt}, ${ageHours} hours ago. Run `
      + '"Encrypted production backup" by hand, wait for it to finish, then try again.',
    )
  }
  return ageHours
}

async function downloadStoredBackup({ backup, directory, github, store }) {
  if (!backup?.complete || !BACKUP_FILE_PATTERN.test(String(backup.asset?.name ?? ""))) {
    throw new Error("Only a complete stored backup can be fetched.")
  }
  const response = await github.rest.repos.getReleaseAsset({
    asset_id: backup.asset.id,
    headers: { accept: "application/octet-stream" },
    owner: store.owner,
    repo: store.repo,
  })
  const data = Buffer.from(response.data)
  if (sha256(data) !== backup.sha256) {
    throw new Error(`The fetched backup ${backup.name} does not match the checksum recorded when it was stored.`)
  }
  fs.mkdirSync(directory, { mode: 0o700, recursive: true })
  const file = path.join(directory, backup.asset.name)
  fs.writeFileSync(file, data, { flag: "wx", mode: 0o600 })
  return { file, sha256: backup.sha256 }
}

module.exports = {
  BACKUP_PREFIX,
  NO_BACKUP_MESSAGE,
  RECENT_BACKUP_HOURS,
  RETENTION_DAYS,
  assertPrivateStore,
  backupsToPrune,
  describeRelease,
  downloadStoredBackup,
  listStoredBackups,
  newestCompleteBackup,
  parseStoreRepository,
  pruneStoredBackups,
  requireRecentBackup,
  selectBackup,
  storeBackup,
}

import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import {
  captureActors,
  captureScenarios,
  type CaptureActor,
  type CaptureScenario,
  type CaptureViewportSet,
} from "./capture-types"

type FixtureSummary = {
  anchorDate?: unknown
  checksum?: unknown
  counts?: unknown
  representativeAcademyId?: unknown
  scenario?: unknown
  scheduleRange?: unknown
  seedVersion?: unknown
}

function requiredChoice<T extends string>(
  value: string,
  choices: readonly T[],
  variableName: string,
): T {
  if (choices.includes(value as T)) return value as T
  throw new Error(`${variableName} must be one of: ${choices.join(", ")}`)
}

function positiveInteger(value: string | undefined, fallback: number) {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received ${value}`)
  }
  return parsed
}

function booleanValue(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback
  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) return true
  if (["0", "false", "no", "off"].includes(value.toLowerCase())) return false
  throw new Error(`Expected a boolean value, received ${value}`)
}

function safeLabel(value: string) {
  const label = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (!label) throw new Error("SMBA_CAPTURE_RUN_LABEL must contain a letter or number")
  return label
}

function defaultRunLabel() {
  return `run-${new Date().toISOString().replace(/[:.]/g, "-").toLowerCase()}`
}

function readFixtureSummary(filePath: string | undefined): FixtureSummary | null {
  if (!filePath) return null
  const absolutePath = path.resolve(filePath)
  if (!existsSync(absolutePath)) {
    throw new Error(`SMBA_CAPTURE_FIXTURE_MANIFEST does not exist: ${absolutePath}`)
  }
  const source = JSON.parse(readFileSync(absolutePath, "utf8")) as FixtureSummary
  const sourceWithAliases = source as FixtureSummary & {
    stage?: unknown
    summary?: unknown
  }
  return {
    anchorDate: source.anchorDate,
    checksum: source.checksum,
    counts: source.counts ?? sourceWithAliases.summary,
    representativeAcademyId: source.representativeAcademyId,
    scenario: source.scenario ?? sourceWithAliases.stage,
    scheduleRange: source.scheduleRange,
    seedVersion: source.seedVersion,
  }
}

function parseActors(value: string | undefined, scenario: CaptureScenario) {
  const defaults: CaptureActor[] = ["default", "registrations", "staged"].includes(scenario)
    ? ["guest", "coach"]
    : ["guest", "coach", "player"]
  if (!value) return defaults
  const actors = [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))]
    .map((actor) => requiredChoice(actor, captureActors, "SMBA_CAPTURE_ACTORS"))
  if (!actors.length) throw new Error("SMBA_CAPTURE_ACTORS must select at least one actor")
  return actors
}

function parseOnlyCaptureIds(value: string | undefined) {
  return new Set((value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean))
}

const projectRoot = path.resolve(process.cwd())
const scenario = requiredChoice(
  process.env.SMBA_CAPTURE_SCENARIO ?? "default",
  captureScenarios,
  "SMBA_CAPTURE_SCENARIO",
)
const fixtureSummary = readFixtureSummary(process.env.SMBA_CAPTURE_FIXTURE_MANIFEST)
const runLabel = safeLabel(process.env.SMBA_CAPTURE_RUN_LABEL ?? defaultRunLabel())
const viewportSet = requiredChoice(
  process.env.SMBA_CAPTURE_VIEWPORT_SET ?? "mobile",
  ["mobile", "responsive"] as const satisfies readonly CaptureViewportSet[],
  "SMBA_CAPTURE_VIEWPORT_SET",
)
const outputRoot = path.resolve(
  process.env.SMBA_CAPTURE_OUTPUT_DIR
    ?? path.join(projectRoot, "snapshots", `${viewportSet}-regression`),
)

export const captureSettings = {
  actors: parseActors(process.env.SMBA_CAPTURE_ACTORS, scenario),
  baseURL: process.env.SMBA_CAPTURE_BASE_URL ?? "http://127.0.0.1:3000",
  coachAcademyId: process.env.SMBA_CAPTURE_COACH_ACADEMY_ID ?? "SMBA-HC-0001",
  coachStorageState: process.env.SMBA_CAPTURE_COACH_STORAGE_STATE
    ? path.resolve(process.env.SMBA_CAPTURE_COACH_STORAGE_STATE)
    : undefined,
  fixtureSummary,
  maxFullPageHeight: positiveInteger(process.env.SMBA_CAPTURE_MAX_FULL_PAGE_HEIGHT, 12_000),
  maxSegments: positiveInteger(process.env.SMBA_CAPTURE_MAX_SEGMENTS, 80),
  onlyCaptureIds: parseOnlyCaptureIds(process.env.SMBA_CAPTURE_ONLY),
  outputRoot,
  playerAcademyId: process.env.SMBA_CAPTURE_PLAYER_ACADEMY_ID
    ?? (typeof fixtureSummary?.representativeAcademyId === "string"
      ? fixtureSummary.representativeAcademyId
      : "SMBA-PL-0001"),
  playerStorageState: process.env.SMBA_CAPTURE_PLAYER_STORAGE_STATE
    ? path.resolve(process.env.SMBA_CAPTURE_PLAYER_STORAGE_STATE)
    : undefined,
  projectRoot,
  referenceDate: process.env.SMBA_CAPTURE_REFERENCE_DATE ?? "2026-08-03",
  reportMonth: process.env.SMBA_CAPTURE_REPORT_MONTH ?? "2026-07",
  revision: process.env.SMBA_CAPTURE_REVISION ?? "unlabelled",
  runDir: path.join(outputRoot, runLabel, scenario),
  runLabel,
  scenario,
  strict: booleanValue(process.env.SMBA_CAPTURE_STRICT, true),
  viewportSet,
} as const

if (!/^\d{4}-\d{2}-\d{2}$/.test(captureSettings.referenceDate)) {
  throw new Error("SMBA_CAPTURE_REFERENCE_DATE must use YYYY-MM-DD")
}

if (!/^\d{4}-\d{2}$/.test(captureSettings.reportMonth)) {
  throw new Error("SMBA_CAPTURE_REPORT_MONTH must use YYYY-MM")
}

export function resolveCaptureRoute(route: string) {
  return route
    .replaceAll("{referenceDate}", encodeURIComponent(captureSettings.referenceDate))
    .replaceAll("{reportMonth}", encodeURIComponent(captureSettings.reportMonth))
}

export function storageStateForActor(actor: CaptureActor) {
  if (actor === "guest") return undefined
  return actor === "coach"
    ? captureSettings.coachStorageState
    : captureSettings.playerStorageState
}

export function academyIdForActor(actor: CaptureActor) {
  if (actor === "guest") throw new Error("Guest captures do not have an Academy ID")
  return actor === "coach"
    ? captureSettings.coachAcademyId
    : captureSettings.playerAcademyId
}

export const captureScenarios = [
  "default",
  "staged",
  "registrations",
  "enrollments",
  "schedules",
  "loaded",
] as const

export type CaptureScenario = (typeof captureScenarios)[number]

export const captureActors = ["guest", "coach", "player"] as const

export type CaptureActor = (typeof captureActors)[number]

export type CaptureAction =
  | "adjustment-player-selected"
  | "adjustment-source-selected"
  | "attendance-weekend-adult"
  | "attendance-session-selected"
  | "attendance-year-start"
  | "calendar-month"
  | "calendar-replacement-open"
  | "calendar-session-open"
  | "financial-player-record-open"
  | "login-account-not-found"
  | "login-format-error"
  | "member-contact-reveal"
  | "member-details-open"
  | "member-edit-open"
  | "member-filter-applied"
  | "member-filters-open"
  | "profile-menu-open"
  | "public-fee-weekday-advanced"
  | "public-fee-weekday-standard"
  | "public-fee-weekend"
  | "public-mobile-menu-open"
  | "public-nav-academy"
  | "public-nav-contact"
  | "public-nav-programs"
  | "public-nav-trial"
  | "public-nav-why"
  | "public-trial-filled"
  | "public-trial-popup-blocked"
  | "register-validation-error"
  | "report-checklist-collapse"
  | "report-preview-open"
  | "coach-published-report-open"
  | "schedule-create-weekend"
  | "schedule-programmes-collapse"
  | "schedule-roster-player-selected"
  | "schedule-roster-open"
  | "student-report-open"

export type CaptureViewport = {
  height: number
  label:
    | "mobile-320"
    | "mobile-360"
    | "mobile-390"
    | "mobile-430"
    | "tablet-820"
    | "web-1440"
    | "wide-2560"
  width: number
}

export type CaptureViewportSet = "mobile" | "responsive"

export type SegmentPolicy = "auto" | "always"

export type CaptureDefinition = {
  actions?: CaptureAction[]
  actor: CaptureActor
  critical?: boolean
  description: string
  focusSelector?: string
  id: string
  route: string
  scenarios?: CaptureScenario[]
  segmentPolicy?: SegmentPolicy
  viewportOnly?: boolean
}

export type ConsoleEvidence = {
  location?: {
    columnNumber?: number
    lineNumber?: number
    url?: string
  }
  text: string
  timestamp: string
  type: string
}

export type NetworkEvidence = {
  durationMs?: number
  failure?: string
  method: string
  resourceType: string
  status?: number
  timestamp: string
  url: string
}

export type OverflowElement = {
  className: string
  clientWidth: number
  id: string
  intentional: boolean
  overflowX: string
  path: string
  rect: {
    left: number
    right: number
    width: number
  }
  scrollWidth: number
  tagName: string
}

export type DomEvidence = {
  activeElement: string | null
  ariaExpanded: Array<{ expanded: string | null; text: string }>
  bodyTextLength: number
  counts: {
    buttons: number
    forms: number
    headings: number
    images: number
    incompleteImages: number
    inputs: number
    landmarks: number
    links: number
  }
  document: {
    clientHeight: number
    clientWidth: number
    readyState: string
    scrollHeight: number
    scrollWidth: number
  }
  fontsStatus: string
  headings: Array<{ level: number; text: string }>
  overflow: {
    elements: OverflowElement[]
    pageOverflow: boolean
  }
  title: string
  url: string
}

export type PerformanceEvidence = {
  captureMs: number
  navigation: Record<string, number | string> | null
  resources: {
    count: number
    durationMs: number
    transferSize: number
  }
  settleMs: number
  totalMs: number
}

export type CaptureArtifact = {
  kind: "full-page" | "segment" | "viewport"
  path: string
  scrollY?: number
}

export type CaptureEvidence = {
  actions: Array<{
    action: CaptureAction
    durationMs: number
  }>
  artifacts: CaptureArtifact[]
  console: ConsoleEvidence[]
  dom: DomEvidence | null
  error: string | null
  httpErrors: NetworkEvidence[]
  network: NetworkEvidence[]
  pageErrors: Array<{ message: string; stack?: string; timestamp: string }>
  performance: PerformanceEvidence | null
  requestFailures: NetworkEvidence[]
}

export type CaptureResult = {
  actor: CaptureActor
  description: string
  evidencePath: string
  finishedAt: string
  id: string
  route: string
  scenario: CaptureScenario
  startedAt: string
  status: "failed" | "passed"
  testTitle: string
  viewport: CaptureViewport
  violations: string[]
}

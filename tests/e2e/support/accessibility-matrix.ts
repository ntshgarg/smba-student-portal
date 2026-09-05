export const accessibilityProfiles = ["admin", "clean", "stress"] as const

export type AccessibilityProfile = (typeof accessibilityProfiles)[number]

export const accessibilityViewports = [
  { height: 900, label: "web", width: 1440 },
  { height: 1024, label: "tablet", width: 820 },
  { height: 844, label: "mobile", width: 390 },
] as const

export const compactAccessibilityViewport = {
  height: 568,
  label: "compact-mobile",
  width: 320,
} as const

export type AccessibilityViewport =
  | (typeof accessibilityViewports)[number]
  | typeof compactAccessibilityViewport

export type AccessibilityActor =
  | "guest"
  | "platform-admin"
  | "head-coach"
  | "junior-coach"
  | "player"

export type AccessibilityInteraction =
  | "account-security-errors"
  | "announcement-review-open"
  | "announcement-withdraw-open"
  | "authenticator-recovery-queue"
  | "attendance-session-open"
  | "calendar-session-open"
  | "financial-player-open"
  | "login-error"
  | "login-pin"
  | "member-details-open"
  | "member-filters-open"
  | "mobile-navigation-open"
  | "onboarding-first-open"
  | "player-announcement-open"
  | "player-report-open"
  | "profile-menu-open"
  | "register-error"
  | "register-junior-coach"
  | "report-preview-open"
  | "report-publication-open"
  | "search-admin-directory"

// The interactions that click their way onto a different pathname. Every state
// that uses one has to say where it lands, which
// tests/accessibility-regression-gate.test.ts holds it to. An interaction that
// navigates and is audited with nothing asserting where it went is how
// `coach-player-financial-record` came to be audited against the route it left
// rather than the one it opened, on three of its eight audits per run.
//
// `attendance-session-open` and `onboarding-first-open` are deliberately absent:
// they navigate too, but only over the search string, so they land back on the
// pathname the state already declares and there is nothing left for a second
// check to say. What they share with the three below is the wait, and that lives
// in `settle` rather than here.
export const navigatingAccessibilityInteractions: readonly AccessibilityInteraction[] = [
  "financial-player-open",
  "player-announcement-open",
  "report-publication-open",
]

// Deterministic ids the stress fixture builder assigns, so parameterised routes
// can be deep-linked the same way the query-string routes below already are.
// Report publications get random ids, so those routes are reached by interaction.
const stressAnnouncementId = "00000000-0000-4000-8003-000000000001"
const stressHomepageAnnouncementId = "00000000-0000-4000-8003-000000000002"

export type AccessibilityState = {
  actor: AccessibilityActor
  compact?: boolean
  description: string
  id: string
  interaction?: AccessibilityInteraction
  expectedRoute?: string
  // Where the interaction has to land. `expectedRoute` is checked before the
  // interaction runs and so says nothing about an interaction that navigates --
  // `coach-player-financial-record` clicks its way onto a second route and
  // nothing asserted it arrived. A pattern rather than a path because these
  // destinations carry a fixture-generated id in the pathname.
  //
  // This is a claim about the URL, not about the DOM under it -- the App Router
  // pushes the destination URL at the same moment it shows the loading
  // fallback, so a state can satisfy this while `main` still holds the previous
  // route's skeleton. Waiting for the content is `settle`'s job.
  interactionRoute?: RegExp
  profile: AccessibilityProfile
  route: string
}

export const accessibilityStates: readonly AccessibilityState[] = [
  {
    actor: "guest",
    description: "Public academy homepage",
    id: "public-home",
    profile: "admin",
    route: "/",
  },
  {
    actor: "guest",
    description: "Public mobile navigation disclosure",
    id: "public-mobile-navigation",
    interaction: "mobile-navigation-open",
    profile: "admin",
    route: "/",
  },
  {
    actor: "guest",
    compact: true,
    description: "Password login",
    id: "login-password",
    profile: "admin",
    route: "/login",
  },
  {
    actor: "guest",
    compact: true,
    description: "PIN login",
    id: "login-pin",
    interaction: "login-pin",
    profile: "admin",
    route: "/login",
  },
  {
    actor: "guest",
    compact: true,
    description: "Login validation error",
    id: "login-error",
    interaction: "login-error",
    profile: "admin",
    route: "/login",
  },
  {
    actor: "guest",
    compact: true,
    description: "Player registration request",
    id: "register-player",
    profile: "admin",
    route: "/register",
  },
  {
    actor: "guest",
    compact: true,
    description: "Junior-coach registration request",
    id: "register-junior-coach",
    interaction: "register-junior-coach",
    profile: "admin",
    route: "/register",
  },
  {
    actor: "guest",
    compact: true,
    description: "Registration validation error",
    id: "register-error",
    interaction: "register-error",
    profile: "admin",
    route: "/register",
  },
  {
    actor: "guest",
    compact: true,
    description: "Activation without a browser receipt",
    id: "activation-missing",
    profile: "admin",
    route: "/activate",
  },
  {
    actor: "guest",
    compact: true,
    description: "Password recovery request",
    id: "password-recovery",
    profile: "admin",
    route: "/recover",
  },
  {
    actor: "guest",
    compact: true,
    description: "Unavailable password-reset link",
    id: "password-reset-unavailable",
    profile: "admin",
    route: "/recover/reset",
  },
  {
    actor: "guest",
    compact: true,
    description: "Protected-account recovery entry",
    id: "authenticator-recovery",
    profile: "admin",
    route: "/auth/two-factor/recovery",
  },
  {
    actor: "guest",
    compact: true,
    // The page redirects only when getCurrentIdentity() returns an identity
    // (app/auth/two-factor/page.tsx:17-24), so a signed-out visit renders the very
    // form a coach meets mid-sign-in. TwoFactorVerificationForm takes no server
    // props, so no half-authenticated session has to be held open to audit it.
    description: "Authenticator verification challenge",
    id: "authenticator-verification",
    profile: "admin",
    route: "/auth/two-factor",
  },
  {
    actor: "guest",
    compact: true,
    // Without the one-time setup cookie the page renders its unavailable notice
    // rather than redirecting (app/setup/head-coach/page.tsx:58), so the branch a
    // stale or already-completed setup link lands on is reachable as a guest.
    description: "Unavailable head-coach setup session",
    id: "head-coach-setup-unavailable",
    profile: "admin",
    route: "/setup/head-coach",
  },
  {
    actor: "guest",
    description: "Unknown address",
    id: "not-found",
    profile: "admin",
    route: "/this-address-does-not-exist",
  },
  {
    actor: "platform-admin",
    description: "Platform-owner directory",
    id: "admin-dashboard",
    profile: "admin",
    route: "/admin",
  },
  {
    actor: "platform-admin",
    description: "Platform-owner search results",
    id: "admin-search",
    interaction: "search-admin-directory",
    profile: "admin",
    route: "/admin",
  },
  {
    actor: "platform-admin",
    compact: true,
    description: "Platform-owner account-security validation",
    id: "admin-account-security",
    interaction: "account-security-errors",
    profile: "admin",
    route: "/account/security",
  },
  {
    actor: "platform-admin",
    compact: true,
    description: "Platform-owner recovery-email enrolment",
    id: "admin-recovery-email-setup",
    profile: "admin",
    route: "/account/recovery-email/setup",
  },
  {
    actor: "platform-admin",
    compact: true,
    description: "Platform-owner authenticator reconnection",
    id: "admin-authenticator-reconnect",
    profile: "admin",
    route: "/auth/two-factor/reconnect",
  },
  {
    actor: "guest",
    compact: true,
    description: "Clean activation browser baseline",
    id: "clean-activation-baseline",
    profile: "clean",
    route: "/activate",
  },
  {
    actor: "head-coach",
    compact: true,
    // Only the clean academy has no finance-activation audit event, so this is
    // the one profile where the route renders instead of redirecting to records.
    description: "Financial tracking not yet started",
    id: "coach-financials-activation",
    profile: "clean",
    route: "/coach/financials",
  },
  {
    actor: "guest",
    description: "Public academy notice",
    id: "public-announcement-detail",
    profile: "stress",
    route: `/announcements/${stressHomepageAnnouncementId}`,
  },
  {
    actor: "head-coach",
    description: "Coach dashboard",
    id: "coach-dashboard",
    profile: "stress",
    route: "/coach",
  },
  {
    actor: "head-coach",
    description: "Coach profile menu",
    id: "coach-profile-menu",
    interaction: "profile-menu-open",
    profile: "stress",
    route: "/coach",
  },
  {
    actor: "head-coach",
    description: "Academy onboarding queue",
    id: "coach-onboarding",
    interaction: "onboarding-first-open",
    profile: "stress",
    route: "/coach/onboarding",
  },
  {
    actor: "head-coach",
    description: "Member Directory filters",
    id: "coach-members-filters",
    interaction: "member-filters-open",
    profile: "stress",
    route: "/coach/members",
  },
  {
    actor: "head-coach",
    description: "Member Directory details",
    id: "coach-members-details",
    interaction: "member-details-open",
    profile: "stress",
    route: "/coach/members",
  },
  {
    actor: "head-coach",
    description: "Training calendar session detail",
    id: "coach-calendar",
    interaction: "calendar-session-open",
    profile: "stress",
    route: "/coach/calendar?date=2026-08-03",
  },
  {
    actor: "head-coach",
    description: "Schedules and rosters",
    id: "coach-schedules",
    profile: "stress",
    route: "/coach/schedules",
  },
  {
    actor: "head-coach",
    compact: true,
    description: "Create schedule form",
    id: "coach-create-schedule",
    profile: "stress",
    route: "/coach/schedules/new",
  },
  {
    actor: "head-coach",
    description: "Player attendance register",
    id: "coach-player-attendance-register",
    profile: "stress",
    route: "/coach/attendance/players/register?year=2026&batch=Weekday&level=Beginner",
  },
  {
    actor: "head-coach",
    compact: true,
    description: "Player attendance recorder",
    id: "coach-player-attendance-record",
    interaction: "attendance-session-open",
    profile: "stress",
    route: "/coach/attendance/players/record?date=2026-08-03",
  },
  {
    actor: "head-coach",
    description: "Staff attendance register",
    id: "coach-staff-attendance-register",
    profile: "stress",
    route: "/coach/attendance/staff/register",
  },
  {
    actor: "head-coach",
    compact: true,
    description: "Staff roll call",
    id: "coach-staff-roll-call",
    profile: "stress",
    route: "/coach/attendance/staff/record?date=2026-08-03",
  },
  {
    actor: "head-coach",
    compact: true,
    description: "Attendance rescheduling",
    id: "coach-attendance-adjustments",
    profile: "stress",
    route: "/coach/attendance/adjustments",
  },
  {
    actor: "head-coach",
    description: "Published announcements",
    id: "coach-announcements",
    profile: "stress",
    route: "/coach/announcements",
  },
  {
    actor: "head-coach",
    compact: true,
    description: "New announcement form",
    id: "coach-new-announcement",
    profile: "stress",
    route: "/coach/announcements/new",
  },
  {
    actor: "head-coach",
    compact: true,
    description: "Announcement composer review dialog",
    id: "coach-announcement-review",
    interaction: "announcement-review-open",
    profile: "stress",
    route: "/coach/announcements/new",
  },
  {
    actor: "head-coach",
    description: "Published announcement detail",
    id: "coach-announcement-detail",
    profile: "stress",
    route: `/coach/announcements/${stressAnnouncementId}`,
  },
  {
    actor: "head-coach",
    compact: true,
    description: "Announcement withdrawal dialog",
    id: "coach-announcement-withdraw",
    interaction: "announcement-withdraw-open",
    profile: "stress",
    route: `/coach/announcements/${stressAnnouncementId}`,
  },
  {
    actor: "head-coach",
    description: "Published monthly reports",
    id: "coach-reports",
    profile: "stress",
    route: "/coach/reports?period=2026-07",
  },
  {
    actor: "head-coach",
    compact: true,
    description: "Monthly-report writing workspace",
    id: "coach-write-report",
    interaction: "report-preview-open",
    profile: "stress",
    route: "/coach/reports/write?period=2026-08",
  },
  {
    actor: "head-coach",
    description: "Published report detail with a revision history",
    id: "coach-report-publication",
    interaction: "report-publication-open",
    interactionRoute: /^\/coach\/reports\/publications\/[^/]+$/u,
    profile: "stress",
    route: "/coach/reports?period=2026-07",
  },
  {
    actor: "head-coach",
    compact: true,
    description: "Record a payment",
    id: "coach-record-payment",
    profile: "stress",
    route: "/coach/financials/record?scope=outstanding",
  },
  {
    actor: "head-coach",
    description: "Monthly fee records",
    id: "coach-monthly-fees",
    profile: "stress",
    route: "/coach/financials/records?view=fees&mode=monthly&period=2026-08",
  },
  {
    actor: "head-coach",
    description: "Registration fee records",
    id: "coach-registration-fees",
    profile: "stress",
    route: "/coach/financials/records?view=fees&mode=registration&period=2026-08",
  },
  {
    actor: "head-coach",
    description: "Collection records",
    id: "coach-collections",
    profile: "stress",
    route: "/coach/financials/records?view=collections&from=2026-08-01&to=2026-08-31",
  },
  {
    actor: "head-coach",
    description: "Financial activity",
    id: "coach-financial-activity",
    profile: "stress",
    route: "/coach/financials/records?view=activity",
  },
  {
    actor: "head-coach",
    compact: true,
    description: "Player financial record",
    id: "coach-player-financial-record",
    interaction: "financial-player-open",
    interactionRoute: /^\/coach\/financials\/players\/[^/]+$/u,
    profile: "stress",
    route: "/coach/financials/records?view=fees&mode=monthly&period=2026-08",
  },
  {
    actor: "head-coach",
    compact: true,
    description: "Head-coach Account Security",
    id: "coach-account-security",
    profile: "stress",
    route: "/account/security",
  },
  {
    actor: "platform-admin",
    description: "Populated platform-owner directory",
    id: "admin-populated-directory",
    profile: "stress",
    route: "/admin",
  },
  {
    actor: "platform-admin",
    description: "Populated platform-owner search results",
    id: "admin-populated-search",
    interaction: "search-admin-directory",
    profile: "stress",
    route: "/admin",
  },
  {
    actor: "platform-admin",
    compact: true,
    description: "Pending authenticator-recovery approval",
    id: "admin-authenticator-recovery-approval",
    interaction: "authenticator-recovery-queue",
    profile: "stress",
    route: "/admin",
  },
  {
    actor: "junior-coach",
    description: "Junior-coach restricted dashboard",
    id: "junior-coach-dashboard",
    profile: "stress",
    route: "/coach",
  },
  {
    actor: "junior-coach",
    description: "Junior-coach player-register navigation restriction",
    expectedRoute: "/coach",
    id: "junior-coach-attendance-register",
    profile: "stress",
    route: "/coach/attendance/players/register?year=2026&batch=Weekday&level=Beginner",
  },
  {
    actor: "junior-coach",
    compact: true,
    description: "Junior-coach player-roll-call navigation restriction",
    expectedRoute: "/coach",
    id: "junior-coach-player-roll-call",
    profile: "stress",
    route: "/coach/attendance/players/record?date=2026-08-03",
  },
  {
    actor: "junior-coach",
    compact: true,
    description: "Junior-coach Account Security",
    id: "junior-coach-account-security",
    profile: "stress",
    route: "/account/security",
  },
  {
    actor: "junior-coach",
    compact: true,
    description: "Junior-coach personal attendance register",
    id: "junior-coach-personal-attendance",
    profile: "stress",
    route: "/coach?attendance=register&year=2026&month=08",
  },
  {
    actor: "player",
    description: "Player dashboard",
    id: "player-dashboard",
    profile: "stress",
    route: "/player",
  },
  {
    actor: "player",
    compact: true,
    description: "Player attendance register",
    id: "player-attendance",
    profile: "stress",
    route: "/player?attendance=register&year=2026&month=08",
  },
  {
    actor: "player",
    description: "Player expanded monthly report",
    id: "player-report",
    interaction: "player-report-open",
    profile: "stress",
    route: "/player/reports",
  },
  {
    actor: "player",
    description: "Player fee record",
    id: "player-financials",
    profile: "stress",
    route: "/player/financials",
  },
  {
    actor: "player",
    description: "Player announcements",
    id: "player-announcements",
    profile: "stress",
    route: "/player/announcements",
  },
  {
    actor: "player",
    description: "Player announcement detail",
    id: "player-announcement-detail",
    interaction: "player-announcement-open",
    interactionRoute: /^\/player\/announcements\/[^/]+$/u,
    profile: "stress",
    route: "/player/announcements",
  },
  {
    actor: "player",
    compact: true,
    description: "Player Account Security",
    id: "player-account-security",
    profile: "stress",
    route: "/account/security",
  },
  {
    actor: "player",
    compact: true,
    // Keep this last among the stress/player states. The page redirects to /player
    // the moment hasPinCredential is true (app/auth/pin/setup/page.tsx:22-26), so a
    // player state scanned before it must never enrol a PIN; none does today.
    // postAuthenticationDestination sends players straight to /player
    // (lib/auth/post-auth-destination.ts:45), and although activation does end here
    // (app/login/actions.ts:251) the clean walkthrough stops at
    // activation-approved-password without submitting it, so this deep link is what
    // audits the allowSkip variant of the form today.
    description: "Optional player PIN enrolment",
    id: "player-pin-setup",
    profile: "stress",
    route: "/auth/pin/setup",
  },
] as const

export function statesForProfile(profile: AccessibilityProfile) {
  return accessibilityStates.filter((state) => state.profile === profile)
}

export function viewportsForState(state: AccessibilityState): readonly AccessibilityViewport[] {
  return state.compact
    ? [...accessibilityViewports, compactAccessibilityViewport]
    : accessibilityViewports
}

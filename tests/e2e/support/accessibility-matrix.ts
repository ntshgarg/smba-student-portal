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
  | "search-admin-directory"

export type AccessibilityState = {
  actor: AccessibilityActor
  compact?: boolean
  description: string
  id: string
  interaction?: AccessibilityInteraction
  expectedRoute?: string
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
] as const

export function statesForProfile(profile: AccessibilityProfile) {
  return accessibilityStates.filter((state) => state.profile === profile)
}

export function viewportsForState(state: AccessibilityState): readonly AccessibilityViewport[] {
  return state.compact
    ? [...accessibilityViewports, compactAccessibilityViewport]
    : accessibilityViewports
}

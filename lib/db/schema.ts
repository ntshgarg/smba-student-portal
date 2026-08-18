import { relations, sql } from "drizzle-orm"
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  fullName: text("full_name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  registrationRequestFingerprint: text("registration_request_fingerprint"),
  registrationRequestKey: text("registration_request_key"),
  requestedRole: text("requested_role", { enum: ["player", "coach", "platform_admin"] }).notNull(),
  role: text("role", { enum: ["player", "coach", "platform_admin"] }),
  approvalStatus: text("approval_status", {
    enum: ["pending", "approved", "rejected"],
  }).notNull().default("pending"),
  approvedAt: integer("approved_at", { mode: "timestamp_ms" }),
  approvedByAccountId: text("approved_by_account_id").references((): AnySQLiteColumn => accounts.id),
  rejectedAt: integer("rejected_at", { mode: "timestamp_ms" }),
  rejectedByAccountId: text("rejected_by_account_id").references((): AnySQLiteColumn => accounts.id),
  archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
  archivedByAccountId: text("archived_by_account_id").references((): AnySQLiteColumn => accounts.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  index("accounts_approval_status_idx").on(table.approvalStatus),
  index("accounts_role_idx").on(table.role),
  index("accounts_normalized_name_idx").on(table.normalizedName),
  uniqueIndex("accounts_registration_request_key_idx")
    .on(table.registrationRequestKey)
    .where(sql`${table.registrationRequestKey} is not null`),
])

export const academyIdAllocations = sqliteTable("academy_id_allocations", {
  serial: integer("serial").primaryKey({ autoIncrement: true }),
  accountId: text("account_id").notNull().references(() => accounts.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  uniqueIndex("academy_id_allocations_account_idx").on(table.accountId),
])

export const authMethods = sqliteTable("auth_methods", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  method: text("method", { enum: ["academy_id"] }).notNull(),
  identifier: text("identifier").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
}, (table) => [
  uniqueIndex("auth_methods_identifier_idx").on(table.identifier),
  index("auth_methods_account_idx").on(table.accountId),
])

export const authSessions = sqliteTable("auth_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  index("auth_sessions_account_idx").on(table.accountId),
  index("auth_sessions_expiry_idx").on(table.expiresAt),
])

/**
 * Better Auth owns the credential and runtime-session tables below. The
 * application-level `accounts` row remains the source of truth for identity,
 * approval state, and role; Better Auth user IDs intentionally reuse that ID.
 */
export const authUsers = sqliteTable("auth_users", {
  id: text("id").primaryKey().references(() => accounts.id),
  name: text("name").notNull(),
  email: text("email").notNull(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(true),
  image: text("image"),
  username: text("username"),
  displayUsername: text("display_username"),
  twoFactorEnabled: integer("two_factor_enabled", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  uniqueIndex("auth_users_email_idx").on(table.email),
  uniqueIndex("auth_users_username_idx").on(table.username),
])

export const authProviderAccounts = sqliteTable("auth_provider_accounts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => authUsers.id),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  uniqueIndex("auth_provider_accounts_provider_account_idx")
    .on(table.providerId, table.accountId),
  index("auth_provider_accounts_user_idx").on(table.userId),
])

export const authRuntimeSessions = sqliteTable("auth_runtime_sessions", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  token: text("token").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => authUsers.id),
}, (table) => [
  uniqueIndex("auth_runtime_sessions_token_idx").on(table.token),
  index("auth_runtime_sessions_user_idx").on(table.userId),
  index("auth_runtime_sessions_expiry_idx").on(table.expiresAt),
])

export const authVerifications = sqliteTable("auth_verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  index("auth_verifications_identifier_idx").on(table.identifier),
  index("auth_verifications_expiry_idx").on(table.expiresAt),
])

export const authTwoFactors = sqliteTable("auth_two_factors", {
  id: text("id").primaryKey(),
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
  userId: text("user_id").notNull().references(() => authUsers.id),
  verified: integer("verified", { mode: "boolean" }).notNull().default(false),
  failedVerificationCount: integer("failed_verification_count").notNull().default(0),
  lockedUntil: integer("locked_until", { mode: "timestamp_ms" }),
}, (table) => [
  uniqueIndex("auth_two_factors_user_idx").on(table.userId),
  index("auth_two_factors_secret_idx").on(table.secret),
])

export const authRateLimits = sqliteTable("auth_rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  lastRequest: integer("last_request").notNull(),
})

export const authCredentialStates = sqliteTable("auth_credential_states", {
  accountId: text("account_id").primaryKey().references(() => accounts.id),
  status: text("status", {
    enum: ["pending", "active", "reset_required", "revoked"],
  }).notNull().default("pending"),
  activatedAt: integer("activated_at", { mode: "timestamp_ms" }),
  passwordChangedAt: integer("password_changed_at", { mode: "timestamp_ms" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  index("auth_credential_states_status_idx").on(table.status),
  check(
    "auth_credential_states_status_check",
    sql`${table.status} in ('pending', 'active', 'reset_required', 'revoked')`,
  ),
])

export const authActivationClaims = sqliteTable("auth_activation_claims", {
  accountId: text("account_id").primaryKey().references(() => accounts.id),
  tokenHash: text("token_hash").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  consumedAt: integer("consumed_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  uniqueIndex("auth_activation_claims_token_idx").on(table.tokenHash),
  index("auth_activation_claims_expiry_idx").on(table.expiresAt),
])

export const authRecoveryEmails = sqliteTable("auth_recovery_emails", {
  accountId: text("account_id").primaryKey().references(() => accounts.id),
  email: text("email").notNull(),
  verifiedAt: integer("verified_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  // Recovery addresses are intentionally non-unique. Siblings may share a
  // parent or guardian's email and disambiguate recovery with their Academy ID.
  index("auth_recovery_emails_email_idx").on(table.email),
  index("auth_recovery_emails_verified_idx").on(table.verifiedAt),
])

export const authEmailChallenges = sqliteTable("auth_email_challenges", {
  id: text("id").primaryKey(),
  accountId: text("account_id").references(() => accounts.id),
  subjectHash: text("subject_hash").notNull(),
  purpose: text("purpose", {
    enum: ["verify_email", "password_reset"],
  }).notNull(),
  email: text("email").notNull(),
  secretHash: text("secret_hash").notNull(),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  verifiedAt: integer("verified_at", { mode: "timestamp_ms" }),
  claimedAt: integer("claimed_at", { mode: "timestamp_ms" }),
  secondFactorVerifiedAt: integer("second_factor_verified_at", { mode: "timestamp_ms" }),
  consumedAt: integer("consumed_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  uniqueIndex("auth_email_challenges_secret_idx").on(table.secretHash),
  index("auth_email_challenges_account_purpose_idx").on(table.accountId, table.purpose),
  index("auth_email_challenges_subject_purpose_idx").on(table.subjectHash, table.purpose),
  index("auth_email_challenges_expiry_idx").on(table.expiresAt),
  check(
    "auth_email_challenges_purpose_check",
    sql`${table.purpose} in ('verify_email', 'password_reset')`,
  ),
])

export const authPinCredentials = sqliteTable("auth_pin_credentials", {
  accountId: text("account_id").primaryKey().references(() => accounts.id),
  pinHash: text("pin_hash").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  index("auth_pin_credentials_updated_idx").on(table.updatedAt),
])

export const authAccessCodes = sqliteTable("auth_access_codes", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  purpose: text("purpose", { enum: ["activation", "password_reset"] }).notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  consumedAt: integer("consumed_at", { mode: "timestamp_ms" }),
  createdByAccountId: text("created_by_account_id").references(() => accounts.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  uniqueIndex("auth_access_codes_hash_idx").on(table.codeHash),
  uniqueIndex("auth_access_codes_one_active_idx")
    .on(table.accountId, table.purpose)
    .where(sql`${table.consumedAt} is null`),
  index("auth_access_codes_account_idx").on(table.accountId),
  index("auth_access_codes_expiry_idx").on(table.expiresAt),
  check(
    "auth_access_codes_purpose_check",
    sql`${table.purpose} in ('activation', 'password_reset')`,
  ),
])

export const authLoginAttempts = sqliteTable("auth_login_attempts", {
  key: text("key").primaryKey(),
  failedCount: integer("failed_count").notNull().default(0),
  windowStartedAt: integer("window_started_at", { mode: "timestamp_ms" }).notNull(),
  blockedUntil: integer("blocked_until", { mode: "timestamp_ms" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  index("auth_login_attempts_blocked_idx").on(table.blockedUntil),
])

export const authSecurityEvents = sqliteTable("auth_security_events", {
  id: text("id").primaryKey(),
  accountId: text("account_id").references(() => accounts.id),
  actorAccountId: text("actor_account_id").references(() => accounts.id),
  eventType: text("event_type", {
    enum: [
      "activation_issued",
      "account_activated",
      "login_succeeded",
      "login_failed",
      "login_rate_limited",
      "logout",
      "password_changed",
      "password_reset_issued",
      "password_reset_completed",
      "pin_created",
      "pin_changed",
      "pin_removed",
      "sessions_revoked",
      "totp_enabled",
      "totp_verified",
      "totp_failed",
      "recovery_email_verification_requested",
      "recovery_email_verified",
      "recovery_email_changed",
      "password_recovery_requested",
      "password_recovery_second_factor_verified",
      "password_recovery_failed",
      "admin_preview_started",
      "admin_preview_stopped",
    ],
  }).notNull(),
  outcome: text("outcome", { enum: ["success", "failure", "blocked"] }).notNull(),
  subjectHash: text("subject_hash"),
  ipHash: text("ip_hash"),
  userAgent: text("user_agent"),
  metadata: text("metadata").notNull().default("{}"),
  occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  index("auth_security_events_account_idx").on(table.accountId, table.occurredAt),
  index("auth_security_events_type_idx").on(table.eventType, table.occurredAt),
  index("auth_security_events_occurred_idx").on(table.occurredAt),
])

export const coachProfiles = sqliteTable("coach_profiles", {
  accountId: text("account_id").primaryKey().references(() => accounts.id),
  accessLevel: text("access_level", {
    enum: ["head_admin", "junior_coach"],
  }).notNull(),
  joinedOn: text("joined_on").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  index("coach_profiles_access_level_idx").on(table.accessLevel),
  check(
    "coach_profiles_access_level_check",
    sql`${table.accessLevel} in ('head_admin', 'junior_coach')`,
  ),
  check(
    "coach_profiles_joined_on_check",
    sql`${table.joinedOn} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' and date(${table.joinedOn}) = ${table.joinedOn}`,
  ),
])

export const staffAttendanceRecords = sqliteTable("staff_attendance_records", {
  id: text("id").primaryKey(),
  coachAccountId: text("coach_account_id").notNull().references(() => coachProfiles.accountId),
  dateKey: text("date_key").notNull(),
  choice: text("choice", { enum: ["present", "absent", "cleared"] }).notNull(),
  markedByAccountId: text("marked_by_account_id").notNull().references(() => coachProfiles.accountId),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  uniqueIndex("staff_attendance_coach_date_idx").on(table.coachAccountId, table.dateKey),
  index("staff_attendance_date_idx").on(table.dateKey),
  check(
    "staff_attendance_choice_check",
    sql`${table.choice} in ('present', 'absent', 'cleared')`,
  ),
  check(
    "staff_attendance_date_key_check",
    sql`${table.dateKey} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' and date(${table.dateKey}) = ${table.dateKey}`,
  ),
])

export const playerEnrollments = sqliteTable("player_enrollments", {
  accountId: text("account_id").primaryKey().references(() => accounts.id),
  ageGroup: text("age_group"),
  level: text("level", { enum: ["Beginner", "Intermediate", "Advanced", "Adult"] }),
  batch: text("batch", { enum: ["Weekday", "Weekend"] }),
  academyPlan: text("academy_plan", {
    enum: ["weekday-3-day", "weekday-4-day", "weekday-5-day", "weekend-standard"],
  }),
  status: text("status", { enum: ["unassigned", "active", "paused"] }).notNull().default("unassigned"),
  joinedAt: integer("joined_at", { mode: "timestamp_ms" }).notNull(),
  primaryContactName: text("primary_contact_name"),
  primaryContactRelationship: text("primary_contact_relationship"),
  primaryContactPhone: text("primary_contact_phone"),
  recordRevision: integer("record_revision").notNull().default(0),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
})

export const batches = sqliteTable("batches", {
  id: text("id").primaryKey(),
  schedule: text("schedule", { enum: ["Weekday", "Weekend"] }).notNull(),
  programme: text("programme", { enum: ["Beginner", "Intermediate", "Advanced", "Adult"] }).notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
})

export const batchMemberships = sqliteTable("batch_memberships", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  batchId: text("batch_id").notNull().references(() => batches.id),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  endedAt: integer("ended_at", { mode: "timestamp_ms" }),
}, (table) => [
  index("batch_memberships_account_idx").on(table.accountId),
  index("batch_memberships_batch_idx").on(table.batchId),
  uniqueIndex("batch_memberships_one_current_per_account_idx")
    .on(table.accountId)
    .where(sql`${table.endedAt} is null`),
])

export const attendanceRecords = sqliteTable("attendance_records", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  batchId: text("batch_id").notNull().references(() => batches.id),
  dateKey: text("date_key").notNull(),
  choice: text("choice", { enum: ["present", "absent", "cleared"] }).notNull(),
  markedByAccountId: text("marked_by_account_id").notNull().references(() => accounts.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  uniqueIndex("attendance_account_batch_date_idx").on(table.accountId, table.batchId, table.dateKey),
  index("attendance_date_idx").on(table.dateKey),
])

export const sessionSeries = sqliteTable("session_series", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  programme: text("programme", { enum: ["Beginner", "Intermediate", "Advanced", "Adult"] }).notNull(),
  batch: text("batch", { enum: ["Weekday", "Weekend"] }).notNull(),
  venue: text("venue").notNull(),
  startsOn: text("starts_on").notNull(),
  endsOn: text("ends_on"),
  status: text("status", { enum: ["active", "ended"] }).notNull().default("active"),
  replacedSeriesId: text("replaced_series_id").references((): AnySQLiteColumn => sessionSeries.id),
  createdByAccountId: text("created_by_account_id").notNull().references(() => accounts.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  index("session_series_status_idx").on(table.status),
  index("session_series_dates_idx").on(table.startsOn, table.endsOn),
])

export const sessionRecurrenceRules = sqliteTable("session_recurrence_rules", {
  id: text("id").primaryKey(),
  seriesId: text("series_id").notNull().references(() => sessionSeries.id),
  weekday: integer("weekday").notNull(),
  startTime: text("start_time").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
}, (table) => [
  uniqueIndex("session_recurrence_series_weekday_idx").on(table.seriesId, table.weekday),
  index("session_recurrence_series_idx").on(table.seriesId),
])

export const sessionOccurrences = sqliteTable("session_occurrences", {
  id: text("id").primaryKey(),
  seriesId: text("series_id").notNull().references(() => sessionSeries.id),
  occurrenceDate: text("occurrence_date").notNull(),
  startsAt: integer("starts_at", { mode: "timestamp_ms" }).notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  venue: text("venue").notNull(),
  status: text("status", { enum: ["scheduled", "cancelled"] }).notNull().default("scheduled"),
  replacementForOccurrenceId: text("replacement_for_occurrence_id")
    .references((): AnySQLiteColumn => sessionOccurrences.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  uniqueIndex("session_occurrences_series_date_idx")
    .on(table.seriesId, table.occurrenceDate)
    .where(sql`${table.status} = 'scheduled'`),
  uniqueIndex("session_occurrences_active_replacement_idx")
    .on(table.replacementForOccurrenceId)
    .where(sql`${table.replacementForOccurrenceId} is not null and ${table.status} = 'scheduled'`),
  index("session_occurrences_date_idx").on(table.occurrenceDate),
  index("session_occurrences_series_idx").on(table.seriesId),
])

export const sessionAssignments = sqliteTable("session_assignments", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  seriesId: text("series_id").notNull().references(() => sessionSeries.id),
  effectiveFrom: text("effective_from").notNull(),
  effectiveTo: text("effective_to"),
  assignedByAccountId: text("assigned_by_account_id").notNull().references(() => accounts.id),
  assignedAt: integer("assigned_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  index("session_assignments_account_idx").on(table.accountId),
  index("session_assignments_series_idx").on(table.seriesId),
  uniqueIndex("session_assignments_one_series_idx")
    .on(table.accountId, table.seriesId)
    .where(sql`${table.effectiveTo} is null`),
])

export const sessionAssignmentWeekdays = sqliteTable("session_assignment_weekdays", {
  id: text("id").primaryKey(),
  assignmentId: text("assignment_id").notNull().references(() => sessionAssignments.id),
  weekday: integer("weekday").notNull(),
}, (table) => [
  uniqueIndex("session_assignment_weekdays_assignment_day_idx")
    .on(table.assignmentId, table.weekday),
  index("session_assignment_weekdays_assignment_idx").on(table.assignmentId),
])

export const sessionAttendanceRecords = sqliteTable("session_attendance_records", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  occurrenceId: text("occurrence_id").notNull().references(() => sessionOccurrences.id),
  choice: text("choice", { enum: ["present", "absent", "cleared"] }).notNull(),
  markedByAccountId: text("marked_by_account_id").notNull().references(() => accounts.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  uniqueIndex("session_attendance_account_occurrence_idx").on(table.accountId, table.occurrenceId),
  index("session_attendance_occurrence_idx").on(table.occurrenceId),
  check(
    "session_attendance_choice_check",
    sql`${table.choice} in ('present', 'absent', 'cleared')`,
  ),
])

export const attendanceAdjustments = sqliteTable("attendance_adjustments", {
  id: text("id").primaryKey(),
  type: text("type", { enum: ["makeup"] }).notNull(),
  playerId: text("player_account_id").notNull().references(() => accounts.id),
  sourceOccurrenceId: text("source_occurrence_id").notNull()
    .references(() => sessionOccurrences.id),
  completedOn: text("completed_on").notNull(),
  completionOccurrenceId: text("completion_occurrence_id")
    .references(() => sessionOccurrences.id),
  reason: text("reason"),
  publishedByAccountId: text("published_by_account_id").notNull()
    .references(() => accounts.id),
  publishedAt: integer("published_at", { mode: "timestamp_ms" }).notNull(),
  reviewRequiredAt: integer("review_required_at", { mode: "timestamp_ms" }),
  voidedByAccountId: text("voided_by_account_id").references(() => accounts.id),
  voidedAt: integer("voided_at", { mode: "timestamp_ms" }),
}, (table) => [
  index("attendance_adjustments_player_idx").on(table.playerId),
  index("attendance_adjustments_completed_on_idx").on(table.completedOn),
  index("attendance_adjustments_review_idx").on(table.reviewRequiredAt),
  uniqueIndex("attendance_adjustments_active_source_idx")
    .on(table.playerId, table.sourceOccurrenceId)
    .where(sql`${table.voidedAt} is null`),
  uniqueIndex("attendance_adjustments_active_completion_idx")
    .on(table.playerId, table.completionOccurrenceId)
    .where(sql`${table.voidedAt} is null and ${table.completionOccurrenceId} is not null`),
])

export const monthlyReports = sqliteTable("monthly_reports", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  month: text("month").notNull(),
  draftText: text("draft_text").notNull().default(""),
  updatedByAccountId: text("updated_by_account_id").notNull().references(() => accounts.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  uniqueIndex("monthly_reports_account_month_idx").on(table.accountId, table.month),
])

export const reportPublications = sqliteTable("report_publications", {
  id: text("id").primaryKey(),
  reportId: text("report_id").notNull().references(() => monthlyReports.id),
  publicationKey: text("publication_key"),
  revision: integer("revision").notNull(),
  reportText: text("report_text").notNull(),
  attendanceSnapshot: text("attendance_snapshot"),
  publishedByAccountId: text("published_by_account_id").notNull().references(() => accounts.id),
  publishedAt: integer("published_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  uniqueIndex("report_publications_report_revision_idx").on(table.reportId, table.revision),
  uniqueIndex("report_publications_publication_key_idx")
    .on(table.publicationKey)
    .where(sql`${table.publicationKey} is not null`),
  index("report_publications_report_idx").on(table.reportId),
])

export const feeAgreements = sqliteTable("fee_agreements", {
  id: text("id").primaryKey(),
  playerAccountId: text("player_account_id").notNull().references(() => accounts.id),
  academyPlan: text("academy_plan", {
    enum: ["weekday-3-day", "weekday-4-day", "weekday-5-day", "weekend-standard"],
  }).notNull(),
  level: text("level", { enum: ["Beginner", "Intermediate", "Advanced", "Adult"] }).notNull(),
  batch: text("batch", { enum: ["Weekday", "Weekend"] }).notNull(),
  agreedMonthlyFeePaise: integer("agreed_monthly_fee_paise").notNull(),
  currency: text("currency").notNull().default("INR"),
  monthlyDueDay: integer("monthly_due_day").notNull().default(5),
  effectiveFrom: text("effective_from").notNull(),
  effectiveTo: text("effective_to"),
  status: text("status", { enum: ["active", "paused", "ended"] }).notNull().default("active"),
  recordRevision: integer("record_revision").notNull().default(0),
  createdByAccountId: text("created_by_account_id").notNull().references(() => accounts.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedByAccountId: text("updated_by_account_id").notNull().references(() => accounts.id),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  uniqueIndex("fee_agreements_one_active_player_idx")
    .on(table.playerAccountId)
    .where(sql`${table.status} = 'active'`),
  index("fee_agreements_player_dates_idx")
    .on(table.playerAccountId, table.effectiveFrom, table.effectiveTo),
  check("fee_agreements_amount_positive_check", sql`${table.agreedMonthlyFeePaise} > 0`),
  check("fee_agreements_due_day_check", sql`${table.monthlyDueDay} between 1 and 28`),
  check("fee_agreements_currency_check", sql`${table.currency} = 'INR'`),
  check(
    "fee_agreements_dates_check",
    sql`${table.effectiveTo} is null or ${table.effectiveTo} >= ${table.effectiveFrom}`,
  ),
])

export const financialCharges = sqliteTable("financial_charges", {
  id: text("id").primaryKey(),
  feeReference: text("fee_reference").notNull(),
  playerAccountId: text("player_account_id").notNull().references(() => accounts.id),
  feeAgreementId: text("fee_agreement_id").references(() => feeAgreements.id),
  type: text("type", { enum: ["registration", "monthly_training"] }).notNull(),
  billingPeriod: text("billing_period"),
  description: text("description").notNull(),
  originalAmountPaise: integer("original_amount_paise").notNull(),
  currency: text("currency").notNull().default("INR"),
  dueDate: text("due_date").notNull(),
  lifecycle: text("lifecycle", { enum: ["issued", "void"] }).notNull().default("issued"),
  recordRevision: integer("record_revision").notNull().default(0),
  issuedByAccountId: text("issued_by_account_id").notNull().references(() => accounts.id),
  issuedAt: integer("issued_at", { mode: "timestamp_ms" }).notNull(),
  voidedByAccountId: text("voided_by_account_id").references(() => accounts.id),
  voidedAt: integer("voided_at", { mode: "timestamp_ms" }),
  voidReason: text("void_reason"),
}, (table) => [
  uniqueIndex("financial_charges_fee_reference_ci_idx")
    .on(sql`lower(${table.feeReference})`),
  uniqueIndex("financial_charges_one_registration_idx")
    .on(table.playerAccountId)
    .where(sql`${table.type} = 'registration' and ${table.lifecycle} = 'issued'`),
  uniqueIndex("financial_charges_one_monthly_period_idx")
    .on(table.playerAccountId, table.billingPeriod)
    .where(sql`${table.type} = 'monthly_training' and ${table.lifecycle} = 'issued'`),
  index("financial_charges_player_due_idx").on(table.playerAccountId, table.dueDate),
  index("financial_charges_billing_period_idx").on(table.billingPeriod),
  index("financial_charges_register_idx")
    .on(table.type, table.billingPeriod, table.lifecycle, table.playerAccountId, table.dueDate),
  check("financial_charges_amount_positive_check", sql`${table.originalAmountPaise} > 0`),
  check("financial_charges_currency_check", sql`${table.currency} = 'INR'`),
  check(
    "financial_charges_period_check",
    sql`(${table.type} = 'registration' and ${table.billingPeriod} is null)
      or (${table.type} = 'monthly_training' and ${table.billingPeriod} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]')`,
  ),
  check(
    "financial_charges_void_check",
    sql`(${table.lifecycle} = 'issued' and ${table.voidedAt} is null and ${table.voidedByAccountId} is null and ${table.voidReason} is null)
      or (${table.lifecycle} = 'void' and ${table.voidedAt} is not null and ${table.voidedByAccountId} is not null and length(trim(${table.voidReason})) > 0)`,
  ),
])

export const payments = sqliteTable("payments", {
  id: text("id").primaryKey(),
  chargeId: text("charge_id").references(() => financialCharges.id),
  playerAccountId: text("player_account_id").notNull().references(() => accounts.id),
  receiptReference: text("receipt_reference").notNull(),
  amountPaise: integer("amount_paise").notNull(),
  currency: text("currency").notNull().default("INR"),
  receivedOn: text("received_on").notNull(),
  method: text("method", {
    enum: ["cash", "upi", "bank_transfer", "card", "cheque", "other"],
  }).notNull(),
  externalReference: text("external_reference"),
  internalNote: text("internal_note"),
  lifecycle: text("lifecycle", { enum: ["recorded", "reversed"] }).notNull().default("recorded"),
  idempotencyKey: text("idempotency_key").notNull(),
  payloadFingerprint: text("payload_fingerprint").notNull(),
  recordRevision: integer("record_revision").notNull().default(0),
  recordedByAccountId: text("recorded_by_account_id").notNull().references(() => accounts.id),
  recordedAt: integer("recorded_at", { mode: "timestamp_ms" }).notNull(),
  reversedByAccountId: text("reversed_by_account_id").references(() => accounts.id),
  reversedAt: integer("reversed_at", { mode: "timestamp_ms" }),
  reversalReason: text("reversal_reason"),
}, (table) => [
  uniqueIndex("payments_idempotency_key_idx").on(table.idempotencyKey),
  uniqueIndex("payments_receipt_reference_idx").on(table.receiptReference),
  index("payments_charge_idx").on(table.chargeId),
  index("payments_player_idx").on(table.playerAccountId),
  index("payments_received_lifecycle_idx").on(table.receivedOn, table.lifecycle),
  check("payments_amount_positive_check", sql`${table.amountPaise} > 0`),
  check("payments_currency_check", sql`${table.currency} = 'INR'`),
  check(
    "payments_reversal_check",
    sql`(${table.lifecycle} = 'recorded' and ${table.reversedAt} is null and ${table.reversedByAccountId} is null and ${table.reversalReason} is null)
      or (${table.lifecycle} = 'reversed' and ${table.reversedAt} is not null and ${table.reversedByAccountId} is not null and length(trim(${table.reversalReason})) > 0)`,
  ),
])

export const paymentAllocations = sqliteTable("payment_allocations", {
  id: text("id").primaryKey(),
  paymentId: text("payment_id").notNull().references(() => payments.id),
  chargeId: text("charge_id").notNull().references(() => financialCharges.id),
  amountPaise: integer("amount_paise").notNull(),
  createdByAccountId: text("created_by_account_id").notNull().references(() => accounts.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  uniqueIndex("payment_allocations_payment_charge_idx").on(table.paymentId, table.chargeId),
  index("payment_allocations_charge_idx").on(table.chargeId),
  check("payment_allocations_amount_positive_check", sql`${table.amountPaise} > 0`),
])

export const refunds = sqliteTable("refunds", {
  id: text("id").primaryKey(),
  refundReference: text("refund_reference").notNull(),
  paymentId: text("payment_id").notNull().references(() => payments.id),
  playerAccountId: text("player_account_id").notNull().references(() => accounts.id),
  purpose: text("purpose", {
    enum: ["legacy_unclassified", "mid_term_withdrawal"],
  }).notNull().default("legacy_unclassified"),
  withdrawalEffectiveOn: text("withdrawal_effective_on"),
  chargeAdjustmentId: text("charge_adjustment_id")
    .references((): AnySQLiteColumn => chargeAdjustments.id),
  amountPaise: integer("amount_paise").notNull(),
  currency: text("currency").notNull().default("INR"),
  refundedOn: text("refunded_on").notNull(),
  method: text("method", {
    enum: ["cash", "upi", "bank_transfer", "card", "cheque", "other"],
  }).notNull(),
  externalReference: text("external_reference"),
  internalNote: text("internal_note"),
  lifecycle: text("lifecycle", { enum: ["recorded", "reversed"] }).notNull().default("recorded"),
  idempotencyKey: text("idempotency_key").notNull(),
  payloadFingerprint: text("payload_fingerprint").notNull(),
  recordRevision: integer("record_revision").notNull().default(0),
  recordedByAccountId: text("recorded_by_account_id").notNull().references(() => accounts.id),
  recordedAt: integer("recorded_at", { mode: "timestamp_ms" }).notNull(),
  reversedByAccountId: text("reversed_by_account_id").references(() => accounts.id),
  reversedAt: integer("reversed_at", { mode: "timestamp_ms" }),
  reversalReason: text("reversal_reason"),
}, (table) => [
  uniqueIndex("refunds_reference_idx").on(table.refundReference),
  uniqueIndex("refunds_idempotency_key_idx").on(table.idempotencyKey),
  index("refunds_payment_idx").on(table.paymentId),
  index("refunds_player_date_idx").on(table.playerAccountId, table.refundedOn),
  index("refunds_date_lifecycle_idx").on(table.refundedOn, table.lifecycle),
  uniqueIndex("refunds_charge_adjustment_idx")
    .on(table.chargeAdjustmentId)
    .where(sql`${table.chargeAdjustmentId} is not null`),
  check("refunds_amount_positive_check", sql`${table.amountPaise} > 0`),
  check("refunds_currency_check", sql`${table.currency} = 'INR'`),
  check(
    "refunds_reversal_check",
    sql`(${table.lifecycle} = 'recorded' and ${table.reversedAt} is null and ${table.reversedByAccountId} is null and ${table.reversalReason} is null)
      or (${table.lifecycle} = 'reversed' and ${table.reversedAt} is not null and ${table.reversedByAccountId} is not null and length(trim(${table.reversalReason})) > 0)`,
  ),
])

export const refundAllocations = sqliteTable("refund_allocations", {
  id: text("id").primaryKey(),
  refundId: text("refund_id").notNull().references(() => refunds.id),
  paymentAllocationId: text("payment_allocation_id").notNull()
    .references(() => paymentAllocations.id),
  amountPaise: integer("amount_paise").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  uniqueIndex("refund_allocations_refund_payment_allocation_idx")
    .on(table.refundId, table.paymentAllocationId),
  index("refund_allocations_payment_allocation_idx").on(table.paymentAllocationId),
  check("refund_allocations_amount_positive_check", sql`${table.amountPaise} > 0`),
])

export const chargeAdjustments = sqliteTable("charge_adjustments", {
  id: text("id").primaryKey(),
  chargeId: text("charge_id").notNull().references(() => financialCharges.id),
  kind: text("kind", {
    enum: [
      "manual_credit",
      "manual_debit",
      "legacy_settlement",
      "concession_credit",
      "withdrawal_credit",
    ],
  }).notNull(),
  amountPaise: integer("amount_paise").notNull(),
  reason: text("reason").notNull(),
  createdByAccountId: text("created_by_account_id").notNull().references(() => accounts.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  reversedByAccountId: text("reversed_by_account_id").references(() => accounts.id),
  reversedAt: integer("reversed_at", { mode: "timestamp_ms" }),
  reversalReason: text("reversal_reason"),
}, (table) => [
  index("charge_adjustments_charge_idx").on(table.chargeId),
  check("charge_adjustments_amount_positive_check", sql`${table.amountPaise} > 0`),
  check("charge_adjustments_reason_check", sql`length(trim(${table.reason})) > 0`),
  check(
    "charge_adjustments_reversal_check",
    sql`(${table.reversedAt} is null and ${table.reversedByAccountId} is null and ${table.reversalReason} is null)
      or (${table.reversedAt} is not null and ${table.reversedByAccountId} is not null and length(trim(${table.reversalReason})) > 0)`,
  ),
])

export const concessions = sqliteTable("concessions", {
  id: text("id").primaryKey(),
  playerAccountId: text("player_account_id").notNull().references(() => accounts.id),
  mode: text("mode", { enum: ["one_off", "recurring"] }).notNull(),
  valueKind: text("value_kind", { enum: ["fixed", "percentage"] }).notNull(),
  value: integer("value").notNull(),
  startsPeriod: text("starts_period"),
  endsPeriod: text("ends_period"),
  reason: text("reason").notNull(),
  lifecycle: text("lifecycle", { enum: ["active", "reversed"] }).notNull().default("active"),
  idempotencyKey: text("idempotency_key").notNull(),
  payloadFingerprint: text("payload_fingerprint").notNull(),
  recordRevision: integer("record_revision").notNull().default(0),
  createdByAccountId: text("created_by_account_id").notNull().references(() => accounts.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  reversedByAccountId: text("reversed_by_account_id").references(() => accounts.id),
  reversedAt: integer("reversed_at", { mode: "timestamp_ms" }),
  reversalReason: text("reversal_reason"),
}, (table) => [
  uniqueIndex("concessions_idempotency_key_idx").on(table.idempotencyKey),
  index("concessions_player_period_idx")
    .on(table.playerAccountId, table.startsPeriod, table.endsPeriod),
  check("concessions_value_positive_check", sql`${table.value} > 0`),
  check(
    "concessions_value_kind_check",
    sql`${table.valueKind} = 'fixed' or (${table.valueKind} = 'percentage' and ${table.value} <= 10000)`,
  ),
  check(
    "concessions_period_check",
    sql`(${table.mode} = 'one_off' and ${table.startsPeriod} is null and ${table.endsPeriod} is null)
      or (${table.mode} = 'recurring' and ${table.startsPeriod} is not null
        and (${table.endsPeriod} is null or ${table.endsPeriod} >= ${table.startsPeriod}))`,
  ),
  check(
    "concessions_reversal_check",
    sql`(${table.lifecycle} = 'active' and ${table.reversedAt} is null and ${table.reversedByAccountId} is null and ${table.reversalReason} is null)
      or (${table.lifecycle} = 'reversed' and ${table.reversedAt} is not null and ${table.reversedByAccountId} is not null and length(trim(${table.reversalReason})) > 0)`,
  ),
])

export const concessionApplications = sqliteTable("concession_applications", {
  id: text("id").primaryKey(),
  concessionId: text("concession_id").notNull().references(() => concessions.id),
  chargeId: text("charge_id").notNull().references(() => financialCharges.id),
  chargeAdjustmentId: text("charge_adjustment_id").notNull().references(() => chargeAdjustments.id),
  amountPaise: integer("amount_paise").notNull(),
  appliedOn: text("applied_on").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  payloadFingerprint: text("payload_fingerprint").notNull(),
  createdByAccountId: text("created_by_account_id").notNull().references(() => accounts.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  reversedByAccountId: text("reversed_by_account_id").references(() => accounts.id),
  reversedAt: integer("reversed_at", { mode: "timestamp_ms" }),
  reversalReason: text("reversal_reason"),
}, (table) => [
  uniqueIndex("concession_applications_idempotency_idx").on(table.idempotencyKey),
  uniqueIndex("concession_applications_adjustment_idx").on(table.chargeAdjustmentId),
  uniqueIndex("concession_applications_active_charge_idx")
    .on(table.concessionId, table.chargeId)
    .where(sql`${table.reversedAt} is null`),
  index("concession_applications_charge_idx").on(table.chargeId),
  check("concession_applications_amount_positive_check", sql`${table.amountPaise} > 0`),
  check(
    "concession_applications_reversal_check",
    sql`(${table.reversedAt} is null and ${table.reversedByAccountId} is null and ${table.reversalReason} is null)
      or (${table.reversedAt} is not null and ${table.reversedByAccountId} is not null and length(trim(${table.reversalReason})) > 0)`,
  ),
])

export const financeReferenceSequences = sqliteTable("finance_reference_sequences", {
  kind: text("kind", { enum: ["receipt", "refund"] }).notNull(),
  year: integer("year").notNull(),
  lastValue: integer("last_value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.kind, table.year] }),
  check("finance_reference_sequences_year_check", sql`${table.year} between 2000 and 9999`),
  check("finance_reference_sequences_value_check", sql`${table.lastValue} > 0`),
])

export const financialAuditEvents = sqliteTable("financial_audit_events", {
  id: text("id").primaryKey(),
  actorAccountId: text("actor_account_id").notNull().references(() => accounts.id),
  eventType: text("event_type", {
    enum: [
      "finance_activated",
      "fee_agreement_created",
      "fee_agreement_replaced",
      "fee_agreement_paused",
      "fee_agreement_ended",
      "charge_issued",
      "charge_voided",
      "monthly_fees_prepared",
      "payment_recorded",
      "payment_reversed",
      "refund_recorded",
      "refund_reversed",
      "concession_created",
      "concession_applied",
      "concession_application_reversed",
      "concession_reversed",
      "adjustment_created",
      "adjustment_reversed",
      "historical_reconciled",
    ],
  }).notNull(),
  entityType: text("entity_type", {
    enum: [
      "academy", "fee_agreement", "charge", "payment", "adjustment", "player",
      "refund", "concession", "concession_application",
    ],
  }).notNull(),
  entityId: text("entity_id").notNull(),
  idempotencyKey: text("idempotency_key"),
  metadata: text("metadata").notNull().default("{}"),
  occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  uniqueIndex("financial_audit_idempotency_idx")
    .on(table.idempotencyKey)
    .where(sql`${table.idempotencyKey} is not null`),
  uniqueIndex("financial_audit_one_activation_idx")
    .on(table.entityId)
    .where(sql`${table.eventType} = 'finance_activated' and ${table.entityType} = 'academy'`),
  index("financial_audit_entity_idx").on(table.entityType, table.entityId),
  index("financial_audit_occurred_idx").on(table.occurredAt),
  index("financial_audit_type_occurred_idx").on(table.eventType, table.occurredAt),
])

export const broadcasts = sqliteTable("broadcasts", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  publishedByAccountId: text("published_by_account_id").notNull()
    .references(() => accounts.id),
  publishedAt: integer("published_at", { mode: "timestamp_ms" }).notNull(),
  expiresOn: text("expires_on"),
  publicationKey: text("publication_key").notNull(),
  payloadFingerprint: text("payload_fingerprint").notNull(),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  presentationRevision: integer("presentation_revision").notNull().default(0),
  presentationUpdatedByAccountId: text("presentation_updated_by_account_id").notNull()
    .references(() => accounts.id),
  presentationUpdatedAt: integer("presentation_updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  uniqueIndex("broadcasts_publication_key_idx").on(table.publicationKey),
  index("broadcasts_published_at_idx").on(table.publishedAt),
  index("broadcasts_expires_on_idx").on(table.expiresOn),
  check(
    "broadcasts_title_length_check",
    sql`length(trim(${table.title})) between 1 and 120`,
  ),
  check(
    "broadcasts_content_length_check",
    sql`length(trim(${table.content})) between 1 and 5000`,
  ),
  check(
    "broadcasts_expiry_check",
    sql`${table.expiresOn} is null or (
      ${table.expiresOn} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      and date(${table.expiresOn}) = ${table.expiresOn}
      and ${table.expiresOn} >= date(${table.publishedAt} / 1000, 'unixepoch', '+330 minutes')
    )`,
  ),
  check(
    "broadcasts_presentation_revision_check",
    sql`${table.presentationRevision} >= 0`,
  ),
])

export const broadcastAudienceTargets = sqliteTable("broadcast_audience_targets", {
  broadcastId: text("broadcast_id").notNull().references(() => broadcasts.id),
  audience: text("audience", { enum: ["everyone"] }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.broadcastId, table.audience] }),
  uniqueIndex("broadcast_audience_one_target_idx").on(table.broadcastId),
  check("broadcast_audience_value_check", sql`${table.audience} = 'everyone'`),
])

export const broadcastChannels = sqliteTable("broadcast_channels", {
  broadcastId: text("broadcast_id").notNull().references(() => broadcasts.id),
  channel: text("channel", { enum: ["homepage", "player_dashboard"] }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.broadcastId, table.channel] }),
  index("broadcast_channels_channel_idx").on(table.channel, table.broadcastId),
  check(
    "broadcast_channels_value_check",
    sql`${table.channel} in ('homepage', 'player_dashboard')`,
  ),
])

export const broadcastWithdrawals = sqliteTable("broadcast_withdrawals", {
  id: text("id").primaryKey(),
  broadcastId: text("broadcast_id").notNull().references(() => broadcasts.id),
  reason: text("reason").notNull(),
  withdrawnByAccountId: text("withdrawn_by_account_id").notNull()
    .references(() => accounts.id),
  withdrawnAt: integer("withdrawn_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  uniqueIndex("broadcast_withdrawals_broadcast_idx").on(table.broadcastId),
  index("broadcast_withdrawals_withdrawn_at_idx").on(table.withdrawnAt),
  check(
    "broadcast_withdrawals_reason_length_check",
    sql`length(trim(${table.reason})) between 1 and 250`,
  ),
])

export const accountsRelations = relations(accounts, ({ one, many }) => ({
  academyId: one(academyIdAllocations, {
    fields: [accounts.id],
    references: [academyIdAllocations.accountId],
  }),
  authMethods: many(authMethods),
  enrollment: one(playerEnrollments, {
    fields: [accounts.id],
    references: [playerEnrollments.accountId],
  }),
  batchMemberships: many(batchMemberships),
  attendance: many(attendanceRecords),
  sessionAssignments: many(sessionAssignments),
  sessionAttendance: many(sessionAttendanceRecords),
  attendanceAdjustments: many(attendanceAdjustments),
  feeAgreements: many(feeAgreements),
  financialCharges: many(financialCharges),
  payments: many(payments),
  refunds: many(refunds),
  concessions: many(concessions),
  reports: many(monthlyReports),
  publishedBroadcasts: many(broadcasts, { relationName: "publishedBroadcasts" }),
}))

export const broadcastRelations = relations(broadcasts, ({ one, many }) => ({
  publishedBy: one(accounts, {
    fields: [broadcasts.publishedByAccountId],
    references: [accounts.id],
    relationName: "publishedBroadcasts",
  }),
  audienceTargets: many(broadcastAudienceTargets),
  channels: many(broadcastChannels),
  withdrawal: one(broadcastWithdrawals, {
    fields: [broadcasts.id],
    references: [broadcastWithdrawals.broadcastId],
  }),
}))

export const broadcastAudienceTargetRelations = relations(
  broadcastAudienceTargets,
  ({ one }) => ({
    broadcast: one(broadcasts, {
      fields: [broadcastAudienceTargets.broadcastId],
      references: [broadcasts.id],
    }),
  }),
)

export const broadcastChannelRelations = relations(broadcastChannels, ({ one }) => ({
  broadcast: one(broadcasts, {
    fields: [broadcastChannels.broadcastId],
    references: [broadcasts.id],
  }),
}))

export const broadcastWithdrawalRelations = relations(
  broadcastWithdrawals,
  ({ one }) => ({
    broadcast: one(broadcasts, {
      fields: [broadcastWithdrawals.broadcastId],
      references: [broadcasts.id],
    }),
  }),
)

export const playerEnrollmentRelations = relations(playerEnrollments, ({ one }) => ({
  account: one(accounts, {
    fields: [playerEnrollments.accountId],
    references: [accounts.id],
  }),
}))

export const batchMembershipRelations = relations(batchMemberships, ({ one }) => ({
  account: one(accounts, {
    fields: [batchMemberships.accountId],
    references: [accounts.id],
  }),
  batch: one(batches, {
    fields: [batchMemberships.batchId],
    references: [batches.id],
  }),
}))

export const monthlyReportRelations = relations(monthlyReports, ({ one, many }) => ({
  account: one(accounts, {
    fields: [monthlyReports.accountId],
    references: [accounts.id],
  }),
  publications: many(reportPublications),
}))

export const reportPublicationRelations = relations(reportPublications, ({ one }) => ({
  report: one(monthlyReports, {
    fields: [reportPublications.reportId],
    references: [monthlyReports.id],
  }),
}))

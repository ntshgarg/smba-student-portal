import BetterSqlite3 from "better-sqlite3"
import LibsqlDatabase from "libsql"

const source = process.env.SMBA_MONITOR_DATABASE_URL?.trim()
const authToken = process.env.SMBA_MONITOR_DATABASE_TOKEN?.trim()
const lookbackMinutes = Number(process.env.SMBA_MONITOR_LOOKBACK_MINUTES ?? "60")
const lockoutThreshold = Number(process.env.SMBA_MONITOR_LOCKOUT_THRESHOLD ?? "3")
const emailFailureThreshold = Number(process.env.SMBA_MONITOR_EMAIL_FAILURE_THRESHOLD ?? "1")
const applicationErrorThreshold = Number(process.env.SMBA_MONITOR_APPLICATION_ERROR_THRESHOLD ?? "1")
const secondFactorFailureThreshold = Number(process.env.SMBA_MONITOR_SECOND_FACTOR_FAILURE_THRESHOLD ?? "5")

if (!source) throw new Error("SMBA_MONITOR_DATABASE_URL is required.")
const remoteSource = /^(libsql|https|wss):\/\//u.test(source)
if (remoteSource && !authToken) throw new Error("SMBA_MONITOR_DATABASE_TOKEN is required.")
if (!Number.isFinite(lookbackMinutes) || lookbackMinutes < 5) {
  throw new Error("SMBA_MONITOR_LOOKBACK_MINUTES must be at least five.")
}
if (!Number.isInteger(lockoutThreshold) || lockoutThreshold < 1) {
  throw new Error("SMBA_MONITOR_LOCKOUT_THRESHOLD must be a positive integer.")
}
if (!Number.isInteger(emailFailureThreshold) || emailFailureThreshold < 1) {
  throw new Error("SMBA_MONITOR_EMAIL_FAILURE_THRESHOLD must be a positive integer.")
}
if (!Number.isInteger(secondFactorFailureThreshold) || secondFactorFailureThreshold < 1) {
  throw new Error("SMBA_MONITOR_SECOND_FACTOR_FAILURE_THRESHOLD must be a positive integer.")
}
if (!Number.isInteger(applicationErrorThreshold) || applicationErrorThreshold < 1) {
  throw new Error("SMBA_MONITOR_APPLICATION_ERROR_THRESHOLD must be a positive integer.")
}

const database = remoteSource
  ? new LibsqlDatabase(source, { authToken })
  : new BetterSqlite3(source, { fileMustExist: true, readonly: true })
try {
  const since = Date.now() - lookbackMinutes * 60_000
  const signals = database.prepare(`
    SELECT
      coalesce(sum(
        CASE WHEN event_type = 'login_rate_limited' AND outcome = 'blocked'
          THEN 1 ELSE 0 END
      ), 0) AS lockouts,
      coalesce(sum(
        CASE WHEN outcome = 'failure' AND metadata LIKE '%"reason":"email_delivery"%'
          THEN 1 ELSE 0 END
      ), 0) AS email_failures,
      coalesce(sum(
        CASE WHEN event_type = 'totp_verified' AND metadata LIKE '%"method":"backup_code"%'
          THEN 1 ELSE 0 END
      ), 0) AS backup_code_uses,
      coalesce(sum(
        CASE WHEN event_type IN ('totp_reset_requested', 'totp_reset_approved', 'totp_reconnect_started')
          THEN 1 ELSE 0 END
      ), 0) AS authenticator_resets,
      coalesce(sum(
        CASE WHEN event_type = 'totp_failed' AND outcome = 'failure'
          THEN 1 ELSE 0 END
      ), 0) AS second_factor_failures
    FROM auth_security_events
    WHERE occurred_at >= ?
  `).get(since)
  const applicationErrors = database.prepare(`
    SELECT count(*) AS count
    FROM operational_events
    WHERE event_type = 'application_error' AND occurred_at >= ?
  `).get(since)

  const result = {
    applicationErrors: Number(applicationErrors.count),
    authenticatorResets: Number(signals.authenticator_resets),
    backupCodeUses: Number(signals.backup_code_uses),
    emailDeliveryFailures: Number(signals.email_failures),
    lookbackMinutes,
    secondFactorFailures: Number(signals.second_factor_failures),
    securityLockouts: Number(signals.lockouts),
  }
  console.log(JSON.stringify(result))

  const alerts = []
  if (result.applicationErrors >= applicationErrorThreshold) {
    alerts.push(`${result.applicationErrors} server application error(s) (the same error on the same page counts once per 10 minutes)`)
  }
  if (result.emailDeliveryFailures >= emailFailureThreshold) {
    alerts.push(`${result.emailDeliveryFailures} authentication email delivery failure(s)`)
  }
  // Any one of these is worth a look, which is why they have no threshold: the
  // head coach and owner accounts are the ones a recovery code or an
  // authenticator reset gets past the second factor for.
  if (result.backupCodeUses >= 1) {
    alerts.push(`${result.backupCodeUses} recovery code sign-in(s)`)
  }
  if (result.authenticatorResets >= 1) {
    alerts.push(`${result.authenticatorResets} authenticator reset request or approval event(s)`)
  }
  if (result.secondFactorFailures >= secondFactorFailureThreshold) {
    alerts.push(`${result.secondFactorFailures} failed second-factor attempt(s)`)
  }
  if (result.securityLockouts >= lockoutThreshold) {
    alerts.push(`${result.securityLockouts} security lockout event(s)`)
  }
  if (alerts.length) {
    throw new Error(`Production security signals require review: ${alerts.join("; ")}.`)
  }
} finally {
  database.close()
}

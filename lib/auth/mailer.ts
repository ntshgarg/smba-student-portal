import "server-only"

export type RecoveryEmailVerificationMessage = {
  code: string
  expiresInMinutes: number
  fullName: string
  to: string
}

export type PasswordRecoveryMessage = {
  expiresInMinutes: number
  fullName: string
  resetUrl: string
  to: string
}

export type AuthenticatorRecoveryMessage = {
  expiresInMinutes: number
  fullName: string
  recoveryUrl: string
  to: string
}

export interface AuthMailer {
  sendAuthenticatorRecovery(message: AuthenticatorRecoveryMessage): Promise<void>
  sendPasswordRecovery(message: PasswordRecoveryMessage): Promise<void>
  sendRecoveryEmailVerification(message: RecoveryEmailVerificationMessage): Promise<void>
}

export type CapturedAuthEmail =
  | ({ kind: "authenticator-recovery" } & AuthenticatorRecoveryMessage)
  | ({ kind: "recovery-email-verification" } & RecoveryEmailVerificationMessage)
  | ({ kind: "password-recovery" } & PasswordRecoveryMessage)

const memoryOutbox: CapturedAuthEmail[] = []

function memoryAuthMailerAllowed() {
  if (process.env.SMBA_AUTH_MAIL_TRANSPORT !== "memory" || process.env.VERCEL === "1") {
    return false
  }
  if (process.env.NODE_ENV !== "production") return true

  // The accessibility gate deliberately exercises a production build without
  // sending real email. Keep that escape hatch bound to a named test profile
  // and an accessibility-specific disposable database under the OS temp root.
  const profile = process.env.SMBA_ACCESSIBILITY_PROFILE
  const databasePath = process.env.DB_FILE_NAME?.trim() ?? ""
  if (!profile || !["admin", "clean", "stress"].includes(profile)) return false
  const normalizedDatabase = databasePath.replaceAll("\\", "/")
  if (!normalizedDatabase.startsWith("/") || normalizedDatabase.includes("/../")) return false
  const configuredTempRoot = process.env.TMPDIR?.replaceAll("\\", "/").replace(/\/+$/u, "")
  const temporaryPrefixes = [
    "/tmp/",
    "/private/tmp/",
    configuredTempRoot ? `${configuredTempRoot}/` : "",
  ].filter(Boolean)
  const inTemporaryRoot = temporaryPrefixes.some((prefix) => normalizedDatabase.startsWith(prefix))
  const databaseName = normalizedDatabase.split("/").at(-1) ?? ""
  return inTemporaryRoot
    && /smba[-_.].*(accessibility|a11y)|smba-accessibility/u.test(databaseName)
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

function resendConfiguration() {
  return {
    apiKey: process.env.RESEND_API_KEY?.trim() ?? "",
    from: process.env.SMBA_AUTH_EMAIL_FROM?.trim() ?? "",
    replyTo: process.env.SMBA_AUTH_EMAIL_REPLY_TO?.trim() || undefined,
  }
}

export function authEmailRequired() {
  if (process.env.SMBA_REQUIRE_RECOVERY_EMAIL === "true") return true
  if (process.env.SMBA_REQUIRE_RECOVERY_EMAIL === "false") return false
  // Recovery stays dormant until a verified sender is configured. Explicitly
  // enabling it remains fail-closed through validateAuthEmailConfiguration().
  const { apiKey, from } = resendConfiguration()
  return Boolean(apiKey && from)
}

export function validateAuthEmailConfiguration() {
  if (!authEmailRequired()) return
  if (memoryAuthMailerAllowed()) return
  const { apiKey, from } = resendConfiguration()
  if (!apiKey) throw new Error("RESEND_API_KEY is required when recovery email is enforced.")
  if (!from) throw new Error("SMBA_AUTH_EMAIL_FROM is required when recovery email is enforced.")
}

class MemoryAuthMailer implements AuthMailer {
  async sendAuthenticatorRecovery(message: AuthenticatorRecoveryMessage) {
    memoryOutbox.push({ ...message, kind: "authenticator-recovery" })
  }

  async sendRecoveryEmailVerification(message: RecoveryEmailVerificationMessage) {
    memoryOutbox.push({ ...message, kind: "recovery-email-verification" })
  }

  async sendPasswordRecovery(message: PasswordRecoveryMessage) {
    memoryOutbox.push({ ...message, kind: "password-recovery" })
  }
}

class ResendAuthMailer implements AuthMailer {
  constructor(private readonly configuration: ReturnType<typeof resendConfiguration>) {}

  private async send(input: {
    html: string
    subject: string
    text: string
    to: string
  }) {
    const response = await fetch("https://api.resend.com/emails", {
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        from: this.configuration.from,
        html: input.html,
        reply_to: this.configuration.replyTo,
        subject: input.subject,
        text: input.text,
        to: [input.to],
      }),
      headers: {
        Authorization: `Bearer ${this.configuration.apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    })
    if (!response.ok) {
      throw new Error("Authentication email delivery is temporarily unavailable.")
    }
  }

  async sendRecoveryEmailVerification(message: RecoveryEmailVerificationMessage) {
    const name = escapeHtml(message.fullName)
    const code = escapeHtml(message.code)
    await this.send({
      to: message.to,
      subject: "Verify your SMBA recovery email",
      text: `Hello ${message.fullName},\n\nYour SMBA verification code is ${message.code}. It expires in ${message.expiresInMinutes} minutes.\n\nIf you did not request this, you can ignore this email.`,
      html: `<p>Hello ${name},</p><p>Your SMBA verification code is:</p><p style="font-size:28px;letter-spacing:0.18em"><strong>${code}</strong></p><p>It expires in ${message.expiresInMinutes} minutes.</p><p>If you did not request this, you can ignore this email.</p>`,
    })
  }

  async sendAuthenticatorRecovery(message: AuthenticatorRecoveryMessage) {
    const name = escapeHtml(message.fullName)
    const recoveryUrl = escapeHtml(message.recoveryUrl)
    await this.send({
      to: message.to,
      subject: "Verify your SMBA authenticator recovery request",
      text: `Hello ${message.fullName},\n\nOpen this secure link to request platform-admin approval for a fresh SMBA authenticator setup:\n${message.recoveryUrl}\n\nIt expires in ${message.expiresInMinutes} minutes. Your authenticator will not be changed merely by opening the link. If you did not request this, you can ignore this email.`,
      html: `<p>Hello ${name},</p><p>Use the secure link below to verify your email before requesting platform-admin approval for a fresh authenticator setup.</p><p><a href="${recoveryUrl}">Verify recovery request</a></p><p>It expires in ${message.expiresInMinutes} minutes. Your authenticator will not be changed merely by opening the link.</p><p>If you did not request this, you can ignore this email.</p>`,
    })
  }

  async sendPasswordRecovery(message: PasswordRecoveryMessage) {
    const name = escapeHtml(message.fullName)
    const resetUrl = escapeHtml(message.resetUrl)
    await this.send({
      to: message.to,
      subject: "Reset your SMBA password",
      text: `Hello ${message.fullName},\n\nOpen this secure link to reset your SMBA password:\n${message.resetUrl}\n\nIt expires in ${message.expiresInMinutes} minutes. If you did not request this, you can ignore this email.`,
      html: `<p>Hello ${name},</p><p>Use the secure link below to reset your SMBA password.</p><p><a href="${resetUrl}">Reset password</a></p><p>It expires in ${message.expiresInMinutes} minutes. If you did not request this, you can ignore this email.</p>`,
    })
  }
}

export function createAuthMailer(): AuthMailer {
  if (memoryAuthMailerAllowed()) {
    return new MemoryAuthMailer()
  }
  const configuration = resendConfiguration()
  if (!configuration.apiKey || !configuration.from) {
    throw new Error("Authentication email delivery is temporarily unavailable.")
  }
  return new ResendAuthMailer(configuration)
}

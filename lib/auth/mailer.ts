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

export interface AuthMailer {
  sendPasswordRecovery(message: PasswordRecoveryMessage): Promise<void>
  sendRecoveryEmailVerification(message: RecoveryEmailVerificationMessage): Promise<void>
}

export type CapturedAuthEmail =
  | ({ kind: "recovery-email-verification" } & RecoveryEmailVerificationMessage)
  | ({ kind: "password-recovery" } & PasswordRecoveryMessage)

const memoryOutbox: CapturedAuthEmail[] = []

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
  return process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production"
}

export function validateAuthEmailConfiguration() {
  if (!authEmailRequired()) return
  if (process.env.SMBA_AUTH_MAIL_TRANSPORT === "memory"
    && process.env.NODE_ENV !== "production"
    && process.env.VERCEL !== "1") return
  const { apiKey, from } = resendConfiguration()
  if (!apiKey) throw new Error("RESEND_API_KEY is required when recovery email is enforced.")
  if (!from) throw new Error("SMBA_AUTH_EMAIL_FROM is required when recovery email is enforced.")
}

class MemoryAuthMailer implements AuthMailer {
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
  if (process.env.SMBA_AUTH_MAIL_TRANSPORT === "memory"
    && process.env.NODE_ENV !== "production"
    && process.env.VERCEL !== "1") {
    return new MemoryAuthMailer()
  }
  const configuration = resendConfiguration()
  if (!configuration.apiKey || !configuration.from) {
    throw new Error("Authentication email delivery is temporarily unavailable.")
  }
  return new ResendAuthMailer(configuration)
}

/** Test-only transport inspection. Never expose this through a production route. */
export function readCapturedAuthEmails() {
  if (process.env.SMBA_AUTH_MAIL_TRANSPORT !== "memory" || process.env.VERCEL === "1") {
    throw new Error("The authentication email outbox is unavailable.")
  }
  return [...memoryOutbox]
}

export function clearCapturedAuthEmails() {
  memoryOutbox.length = 0
}

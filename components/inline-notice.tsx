import { CheckCircle2, CircleAlert, Info } from "lucide-react"

export type InlineNoticeTone = "success" | "error" | "info"

export type ActionFeedback = {
  message: string
  tone: InlineNoticeTone
}

type InlineNoticeProps = {
  className?: string
  id?: string
  message?: string | null
  reserveSpace?: boolean
  tone?: InlineNoticeTone
}

export function normalizeInlineNoticeMessage(message: string) {
  return message.trim().replace(/[.!?]+$/u, "")
}

const icons = {
  error: CircleAlert,
  info: Info,
  success: CheckCircle2,
} satisfies Record<InlineNoticeTone, typeof Info>

export function InlineNotice({
  className,
  id,
  message,
  reserveSpace = true,
  tone = "info",
}: InlineNoticeProps) {
  const normalizedMessage = message
    ? normalizeInlineNoticeMessage(message)
    : ""
  const Icon = icons[tone]

  return (
    <div
      className={[
        "inline-notice-slot",
        reserveSpace ? "reserves-space" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-empty={normalizedMessage ? undefined : "true"}
    >
      <p
        id={id}
        className={`inline-notice is-${tone}`}
        role={tone === "error" ? "alert" : "status"}
        aria-atomic="true"
      >
        {normalizedMessage ? (
          <>
            <Icon aria-hidden="true" />
            <span>{normalizedMessage}</span>
          </>
        ) : null}
      </p>
    </div>
  )
}

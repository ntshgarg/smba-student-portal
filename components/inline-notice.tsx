import { CheckCircle2, CircleAlert, Info } from "lucide-react"
import Link from "next/link"

export type InlineNoticeTone = "success" | "error" | "info"

/**
 * Somewhere for the coach to go when the notice reports something this screen
 * cannot correct -- an expired sign-in is the case it was added for. Rendered
 * inside the notice paragraph so it inherits the tone colour and the existing
 * 8px gap, and so a screen reader reads the sentence and its way out as one
 * alert rather than announcing the sentence and leaving the action silent.
 */
export type InlineNoticeAction = {
  href: string
  label: string
  /** Opens in a new tab so whatever is typed into this one stays. */
  newTab?: boolean
}

export type ActionFeedback = {
  /** A way out the screen cannot offer itself, shown beside the message. */
  action?: InlineNoticeAction
  message: string
  tone: InlineNoticeTone
}

type InlineNoticeProps = {
  action?: InlineNoticeAction
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
  action,
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
            {/* Keyed on the message so each new confirmation replays the
                success pulse instead of only the first one. */}
            <Icon key={normalizedMessage} aria-hidden="true" />
            <span>{normalizedMessage}</span>
            {action ? (
              <Link
                className="inline-notice-action"
                href={action.href}
                rel={action.newTab ? "noopener" : undefined}
                target={action.newTab ? "_blank" : undefined}
              >
                {action.label}
              </Link>
            ) : null}
          </>
        ) : null}
      </p>
    </div>
  )
}

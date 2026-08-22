import { CircleAlert } from "lucide-react"

export function CoachAccessNotice() {
  return (
    <aside className="coach-access-notice" role="status">
      <CircleAlert aria-hidden="true" />
      <span>
        <strong>Head coach access only.</strong>{" "}
        The page you asked for is not part of the junior coach workspace, so you
        are back on your dashboard.
      </span>
    </aside>
  )
}

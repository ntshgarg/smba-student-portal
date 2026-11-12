/*
 * How every preview screen names the person on show, so the coach pages and
 * the owner console call the same preview the same thing.
 */
export function adminPreviewLabel(input: {
  coachAccessLevel?: "head_admin" | "junior_coach" | null
  fullName: string
  role: "coach" | "player"
}) {
  const role = input.role === "player"
    ? "Player"
    : input.coachAccessLevel === "junior_coach"
      ? "Assistant coach"
      : input.coachAccessLevel === "head_admin" ? "Head coach" : "Coach"
  return `${input.fullName} · ${role}`
}

export function AdminPreviewBanner({ label }: { label: string | null }) {
  return (
    <aside className="admin-preview-banner" role="status">
      {label ? (
        <span><strong>Read-only admin preview</strong> · Viewing {label}</span>
      ) : (
        // The person being viewed was archived or lost their sign-in
        // mid-preview. The preview no longer switches anything off (the proxy
        // checks before refusing a form), so this only says what happened and
        // lets the owner close it, which files the stop record.
        <span>
          <strong>Admin preview</strong> · The account you were viewing is no longer
          available, so you are back in the owner console.
        </span>
      )}
      <form action="/admin/preview/exit" method="post">
        <button type="submit">{label ? "Exit preview" : "Close preview"}</button>
      </form>
    </aside>
  )
}

export function AdminPreviewBanner({ label }: { label: string | null }) {
  return (
    <aside className="admin-preview-banner" role="status">
      {label ? (
        <span><strong>Read-only admin preview</strong> · Viewing {label}</span>
      ) : (
        // The person being viewed was archived or lost access mid-preview, so
        // the owner console is showing -- but changes stay off until Exit.
        <span>
          <strong>Read-only admin preview</strong> · The account you were viewing is no longer
          available. Exit preview to make changes.
        </span>
      )}
      <form action="/admin/preview/exit" method="post">
        <button type="submit">Exit preview</button>
      </form>
    </aside>
  )
}

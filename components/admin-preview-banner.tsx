export function AdminPreviewBanner({ label }: { label: string }) {
  return (
    <aside className="admin-preview-banner" role="status">
      <span><strong>Read-only admin preview</strong> · Viewing {label}</span>
      <form action="/admin/preview/exit" method="post">
        <button type="submit">Exit preview</button>
      </form>
    </aside>
  )
}

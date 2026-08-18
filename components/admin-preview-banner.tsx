import Link from "next/link"

export function AdminPreviewBanner({ label }: { label: string }) {
  return (
    <aside className="admin-preview-banner" role="status">
      <span><strong>Read-only admin preview</strong> · Viewing {label}</span>
      <Link href="/admin/preview/exit">Exit preview</Link>
    </aside>
  )
}

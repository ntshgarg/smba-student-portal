import Link from "next/link"
import { ArrowLeft } from "lucide-react"

export default function NotFound() {
  return (
    <main className="not-found page-shell">
      <p className="eyebrow">Not found</p>
      <h1>This page is outside the lines.</h1>
      <p>The report may have moved, or the address may be incomplete.</p>
      <Link className="primary-link" href="/">
        <ArrowLeft aria-hidden="true" />
        Return to today
      </Link>
    </main>
  )
}

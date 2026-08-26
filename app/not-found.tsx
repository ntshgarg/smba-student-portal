import Link from "next/link"
import { ArrowLeft } from "lucide-react"

/**
 * One page answers every unmatched route -- public, player and coach alike --
 * so it may not assume which of them the visitor came from.
 *
 * It used to do both. "The report may have moved" named one of six things a
 * missing `[param]` route can be, and "Return to today" is dashboard language
 * pointing at `/`, which is the marketing site: a signed-in coach who mistyped a
 * URL was offered, in workspace vocabulary, a way out of the workspace.
 *
 * Deliberately still static and still one link. Reading the session here would
 * let it offer /coach or /player, but it would also turn the prerendered
 * `/_not-found` into a dynamic route for a screen whose whole job is to be
 * cheap; the honest label costs nothing and removes the contradiction.
 */
export default function NotFound() {
  return (
    <main className="not-found page-shell">
      <p className="eyebrow">Not found</p>
      <h1>This page is outside the lines.</h1>
      <p>The page may have moved, or the address may be incomplete.</p>
      <Link className="primary-link" href="/">
        <ArrowLeft aria-hidden="true" />
        Back to the academy
      </Link>
    </main>
  )
}

import Image from "next/image"
import Link from "next/link"

import { AccountMenu } from "@/components/account-menu"
import type { CoachProfile } from "@/lib/coach/types"
import { publicSiteUrl } from "@/lib/config"

export function CoachShell({
  children,
  coach,
}: {
  children: React.ReactNode
  coach: CoachProfile
}) {
  return (
    <>
      <a className="skip-link" href="#coach-main-content">
        Skip to main content
      </a>
      <header className="portal-header coach-portal-header">
        <Link className="portal-brand coach-portal-brand" href="/coach" aria-label="SMBA Coach Workspace home">
          <Image
            src="/images/smba-logo.jpeg"
            alt="Sathiya Moorthy Badminton Academy"
            width={720}
            height={488}
            priority
          />
          <span>
            Coach <em>Workspace</em>
          </span>
        </Link>

        <AccountMenu account={coach} publicSiteHref={publicSiteUrl} />
      </header>

      <main id="coach-main-content">{children}</main>
    </>
  )
}

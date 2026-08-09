import Image from "next/image"
import Link from "next/link"

import { AccountMenu } from "@/components/account-menu"
import type { StudentIdentity } from "@/lib/auth/identity"
import { publicSiteUrl } from "@/lib/config"

export function AppShell({
  student,
  children,
}: {
  student: StudentIdentity
  children: React.ReactNode
}) {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="portal-header">
        <Link className="portal-brand" href="/player" aria-label="SMBA Player Journal home">
          <Image
            src="/images/smba-logo.jpeg"
            alt="Sathiya Moorthy Badminton Academy"
            width={720}
            height={488}
            priority
          />
          <span>
            Player <em>Journal</em>
          </span>
        </Link>

        <AccountMenu account={student} publicSiteHref={publicSiteUrl} />
      </header>

      <main id="main-content">{children}</main>
    </>
  )
}

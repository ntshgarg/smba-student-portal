import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"

import { openPasswordRecoveryLinkAction } from "@/app/recover/actions"
import { RecoveryLinkContinueButton } from "@/components/recovery-link-continue-button"
import {
  passwordRecoveryLinkBlocked,
  protectedResetUnavailableCopy,
  recoveryLinkIsOpenable,
} from "@/lib/auth/recovery-service"
import { publicSiteUrl } from "@/lib/config"

export const metadata: Metadata = {
  title: "Reset your password",
  referrer: "no-referrer",
  robots: { follow: false, index: false },
}

// Opening the emailed link only shows this page, so mail scanners cannot spend
// it; the Continue button uses it up.
export default async function RecoveryLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const token = (await searchParams).token ?? ""
  const blocked = passwordRecoveryLinkBlocked(token)
  const openable = !blocked && recoveryLinkIsOpenable(token, "password")
  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="recovery-link-title">
        <Link className="login-brand" href={publicSiteUrl} aria-label="SMBA homepage">
          <Image src="/images/smba-logo.png" alt="Sathiya Moorthy Badminton Academy" width={720} height={488} priority />
          <span>SMBA <em>Secure access</em></span>
        </Link>
        <div className="login-copy activation-copy">
          <p className="eyebrow">Account recovery</p>
          <h1 id="recovery-link-title">
            {blocked
              ? "This reset needs the platform admin."
              : openable ? "Reset your password." : "This reset link has been used or has expired."}
          </h1>
          <p>{blocked
            ? protectedResetUnavailableCopy(blocked.academyId)
            : openable
              ? "Continue in this browser to choose a new password. The link works once, so finish here."
              : "If you already pressed Continue in another browser, finish there. Otherwise request a new email."}</p>
        </div>
        {openable ? (
          <form className="login-form" action={openPasswordRecoveryLinkAction}>
            <input type="hidden" name="token" value={token} />
            <RecoveryLinkContinueButton />
          </form>
        ) : blocked ? null : (
          <div className="login-empty-state"><Link href="/recover">Request another link</Link></div>
        )}
        <Link className="login-back" href="/login">← Back to login</Link>
      </section>
    </main>
  )
}

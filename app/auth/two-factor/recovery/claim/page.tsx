import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"

import { openAuthenticatorRecoveryLinkAction } from "@/app/auth/two-factor/recovery/actions"
import { RecoveryLinkContinueButton } from "@/components/recovery-link-continue-button"
import { recoveryLinkIsOpenable } from "@/lib/auth/recovery-service"
import { publicSiteUrl } from "@/lib/config"

export const metadata: Metadata = {
  title: "Recover authenticator access",
  referrer: "no-referrer",
  robots: { follow: false, index: false },
}

/*
 * Where the emailed authenticator-recovery link lands. As with the password
 * link (app/recover/claim/page.tsx), opening it only shows this page, so a mail
 * scanner that fetches the link first no longer uses it up; Continue does.
 */
export default async function AuthenticatorRecoveryLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const token = (await searchParams).token ?? ""
  const openable = recoveryLinkIsOpenable(token, "authenticator")
  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="authenticator-link-title">
        <Link className="login-brand" href={publicSiteUrl} aria-label="SMBA homepage">
          <Image src="/images/smba-logo.png" alt="Sathiya Moorthy Badminton Academy" width={720} height={488} priority />
          <span>SMBA <em>Secure access</em></span>
        </Link>
        <div className="login-copy activation-copy">
          <p className="eyebrow">Authenticator recovery</p>
          <h1 id="authenticator-link-title">
            {openable ? "Confirm your recovery request." : "This link has been used or has expired."}
          </h1>
          <p>{openable
            ? "Continue in this browser to send your request to the platform admin. The link works once, so finish here. Nothing changes until the platform admin approves."
            : "If you already pressed Continue in another browser, finish there. Otherwise request a new email."}</p>
        </div>
        {openable ? (
          <form className="login-form" action={openAuthenticatorRecoveryLinkAction}>
            <input type="hidden" name="token" value={token} />
            <RecoveryLinkContinueButton />
          </form>
        ) : (
          <div className="login-empty-state"><Link href="/auth/two-factor/recovery">Request another link</Link></div>
        )}
        <Link className="login-back" href="/auth/two-factor">← Back to authenticator verification</Link>
      </section>
    </main>
  )
}

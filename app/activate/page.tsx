import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"

import { ActivationForm } from "@/components/activation-form"
import { RegistrationStatusForm } from "@/components/registration-status-form"
import { RecoveryEmailEnrollmentForm } from "@/components/recovery-email-enrollment-form"
import { sessionProvider } from "@/lib/data"
import { publicSiteUrl } from "@/lib/config"
import {
  ACTIVATION_CLAIM_COOKIE,
  getActivationClaimStatus,
} from "@/lib/auth/credential-service"
import { hasVerifiedRecoveryEmail } from "@/lib/auth/recovery-service"
import {
  confirmActivationRecoveryEmail,
  requestActivationRecoveryEmail,
} from "@/app/account/recovery-email/actions"
import { postAuthenticationDestination } from "@/lib/auth/post-auth-destination"

export const metadata: Metadata = {
  title: "Activate portal account",
  description: "Secure an approved SMBA Academy ID with a password.",
  robots: { follow: false, index: false },
}

export default async function ActivatePage() {
  const identity = await sessionProvider.getCurrentIdentity()
  if (identity) redirect(postAuthenticationDestination({
    accountId: identity.subjectId,
    role: identity.role,
    twoFactorEnabled: true,
  }))
  const cookieStore = await cookies()
  const status = getActivationClaimStatus(cookieStore.get(ACTIVATION_CLAIM_COOKIE)?.value)
  const approved = status.state === "approved"
  const emailVerified = approved && hasVerifiedRecoveryEmail(status.accountId)

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="activation-title">
        <Link className="login-brand" href={publicSiteUrl} aria-label="SMBA homepage">
          <Image
            src="/images/smba-logo.png"
            alt="Sathiya Moorthy Badminton Academy"
            width={720}
            height={488}
            priority
          />
          <span>Player <em>Journal</em></span>
        </Link>

        <div className="login-copy activation-copy">
          <p className="eyebrow">Private account setup</p>
          <h1 id="activation-title">
            {approved ? emailVerified ? "Create your password." : "Verify your recovery email."
              : status.state === "pending" ? "Approval is pending."
                : status.state === "onboarding" ? "Approved."
                  : status.state === "rejected" ? "Request not approved."
                    : "Check your status."}
          </h1>
          <p>
            {approved ? emailVerified
              ? `Welcome, ${status.fullName}. Your registration is approved.`
              : `Welcome, ${status.fullName}. Verify an email before creating your password.`
              : status.state === "pending" ? `Your coach is reviewing ${status.fullName}’s request.`
                : status.state === "onboarding"
                  ? `Welcome, ${status.fullName}. Your coach is setting up training.`
                  : status.state === "rejected" ? "This registration request was not approved."
                    : status.state === "expired" ? "This registration receipt has expired."
                      : "Enter the name and email you registered with and we’ll send a code."}
          </p>
        </div>

        {approved ? emailVerified
          ? <ActivationForm academyId={status.academyId} />
          : (
            <>
              <div className="login-field activation-academy-id">
                <label htmlFor="approved-academy-id">Your Academy ID</label>
                <input id="approved-academy-id" name="academyId" value={status.academyId} readOnly />
                <p className="login-helper">Save this ID. You will use it every time you sign in.</p>
              </div>
              <RecoveryEmailEnrollmentForm
                requestAction={requestActivationRecoveryEmail}
                confirmAction={confirmActivationRecoveryEmail}
              />
            </>
          ) : (
          status.state === "pending" || status.state === "onboarding" ? (
            // This browser still holds a usable receipt, so it already knows whose
            // request this is. Asking for the name and address again would be
            // busywork; the lookup below is for the browsers that do not.
            <div className="registration-confirmation" role="status">
              <h2>Waiting for your coach.</h2>
              <p>
                {status.state === "onboarding"
                  ? "Your request is approved. You’ll be able to create a password once your coach has finished setting up assessment, sessions and fees."
                  : "Return here after approval to create your password."}
              </p>
              <Link href="/activate">Check again</Link>
            </div>
          ) : (
            /*
             * No usable receipt here. That used to be a dead end -- the cookie was
             * the only link between a person and their request, so clearing it or
             * switching device left "request registration" as the only thing on
             * screen, and some of the duplicate queue is people who took it. Name,
             * email and a fresh code reach the same status from anywhere.
             */
            <RegistrationStatusForm />
          )
        )}

        <Link className="login-back" href="/login">
          <ArrowLeft aria-hidden="true" />
          Back to login
        </Link>
      </section>
    </main>
  )
}

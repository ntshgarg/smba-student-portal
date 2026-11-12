import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import type { ReactNode } from "react"

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

function ActivationShell({ children }: { children: ReactNode }) {
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

        {children}

        <Link className="login-back" href="/login">
          <ArrowLeft aria-hidden="true" />
          Back to login
        </Link>
      </section>
    </main>
  )
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

  if (status.state === "active") {
    /*
     * This browser's receipt belongs to an account that already has a password
     * -- usually because it was just set here and the automatic sign-in did not
     * go through. "Check your status" was the wrong thing to show: there is
     * nothing left to check, only a sign-in to do.
     */
    return (
      <ActivationShell>
        <div className="login-copy activation-copy">
          <p className="eyebrow">Private account setup</p>
          <h1 id="activation-title">Your account is ready.</h1>
          <p>{`Welcome, ${status.fullName}. This account already has a password.`}</p>
        </div>
        <div className="registration-confirmation" role="status">
          <h2>Sign in to continue.</h2>
          <p className="registration-academy-id">
            <span className="operational-eyebrow">Academy ID</span>
            <strong>{status.academyId}</strong>
          </p>
          <p>Use this Academy ID and the password you created.</p>
          <Link href="/login">Sign in</Link>
        </div>
      </ActivationShell>
    )
  }

  return (
    <ActivationShell>
      <div className="login-copy activation-copy">
        <p className="eyebrow">Private account setup</p>
        <h1 id="activation-title">
          {approved ? emailVerified ? "Create your password." : "Verify your recovery email."
            : status.state === "pending" ? "Approval is pending."
              : status.state === "onboarding" ? "Approved."
                : status.state === "rejected" ? "Registration not accepted."
                  : "Check your status."}
        </h1>
        <p>
          {approved ? emailVerified
            ? `Welcome, ${status.fullName}. Your registration is approved.`
            : `Welcome, ${status.fullName}. Verify an email before creating your password.`
            : status.state === "pending" ? `Your coach is reviewing ${status.fullName}’s request.`
              : status.state === "onboarding"
                ? `Welcome, ${status.fullName}. Your coach is setting up training.`
                : status.state === "rejected"
                  ? "This registration was not accepted. Please contact the academy."
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
          <>
            {/*
              This browser still holds a usable receipt, so it already knows whose
              request this is. Asking for the name and address again would be
              busywork; the lookup below is for the browsers that do not.
            */}
            <div className="registration-confirmation" role="status">
              <h2>Waiting for your coach.</h2>
              <p>
                {status.state === "onboarding"
                  ? "Your request is approved. You’ll be able to create a password once your coach has finished setting up assessment, sessions and fees."
                  : "Return here after approval to create your password."}
              </p>
              <Link href="/activate">Check again</Link>
            </div>
            {/*
              One browser holds one receipt, and each new registration replaces
              it. A parent who registered a second child and came back to set up
              the first child's password saw only the second child's waiting box,
              with no way to switch short of another browser. The lookup works for
              anyone the parent can name; if that person is ready, it hands this
              browser their receipt and the password step appears.
            */}
            <details className="activation-other-lookup">
              <summary>Checking on a different player?</summary>
              <p className="login-helper">
                Enter their name and the email they were registered with.
              </p>
              <RegistrationStatusForm />
            </details>
          </>
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
    </ActivationShell>
  )
}

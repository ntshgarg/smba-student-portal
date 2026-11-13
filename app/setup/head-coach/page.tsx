import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { cookies } from "next/headers"

import { HeadCoachSetupForm } from "@/components/head-coach-setup-form"
import { RecoveryEmailEnrollmentForm } from "@/components/recovery-email-enrollment-form"
import {
  confirmHeadSetupRecoveryEmail,
  requestHeadSetupRecoveryEmail,
} from "@/app/account/recovery-email/actions"
import {
  HEAD_COACH_SETUP_COOKIE,
  HEAD_COACH_SETUP_NAME_COOKIE,
  headCoachSetupAvailable,
  validHeadCoachSetupToken,
} from "@/lib/auth/initial-setup"
import {
  getVerifiedSetupRecoveryEmail,
  HEAD_SETUP_EMAIL_COOKIE,
  recoverySubjectKeyForHeadSetup,
} from "@/lib/auth/recovery-service"

export const metadata: Metadata = {
  title: "Set up head coach",
  robots: { follow: false, index: false },
}

export default async function HeadCoachSetupPage() {
  const cookieStore = await cookies()
  const setupToken = cookieStore.get(HEAD_COACH_SETUP_COOKIE)?.value
  const authorized = headCoachSetupAvailable() && validHeadCoachSetupToken(setupToken)
  const verifiedEmail = authorized && setupToken
    ? getVerifiedSetupRecoveryEmail({
      receiptToken: cookieStore.get(HEAD_SETUP_EMAIL_COOKIE)?.value ?? "",
      subjectKey: recoverySubjectKeyForHeadSetup(setupToken),
    })
    : null
  // A cookie, not the address bar, keeps the name out of history and logs.
  const defaultName = cookieStore.get(HEAD_COACH_SETUP_NAME_COOKIE)?.value.slice(0, 80) ?? ""

  return (
    <main className="login-page">
      <section className="login-card head-coach-setup-card" aria-labelledby="head-setup-title">
        <div className="login-brand">
          <Image src="/images/smba-logo.png" alt="Sathiya Moorthy Badminton Academy" width={720} height={488} priority />
          <span>Coach <em>Workspace</em></span>
        </div>
        <div className="login-copy">
          <p className="eyebrow">One-time academy setup</p>
          <h1 id="head-setup-title">{verifiedEmail ? "Create the head-coach account." : "Verify the coach’s email."}</h1>
          <p>{verifiedEmail
            ? <>The reserved username is <strong>SMBA-HC-0001</strong>. Create a password and PIN, then connect an authenticator app.</>
            : "The verified address will be the secure recovery route for this account."}</p>
        </div>
        {authorized ? verifiedEmail
          ? <HeadCoachSetupForm defaultName={defaultName} recoveryEmail={verifiedEmail} />
          : (
            <RecoveryEmailEnrollmentForm
              collectName
              defaultName={defaultName}
              requestAction={requestHeadSetupRecoveryEmail}
              confirmAction={confirmHeadSetupRecoveryEmail}
            />
          ) : (
          <div className="login-empty-state" role="status">
            <p>This setup session has expired, was replaced by a newer one opened on another device, or has already been completed. Ask the academy owner to open setup again if you still need it.</p>
            <Link href="/login">Return to login</Link>
          </div>
        )}
      </section>
    </main>
  )
}

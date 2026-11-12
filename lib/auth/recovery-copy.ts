/*
 * What the password-reset pages say when email alone cannot finish a reset:
 * a protected account (head coach, owner) with no authenticator connected and
 * no authenticator reset approved for this recovery email in the last 24 hours.
 * The owner is not told to "speak to the platform admin" -- that is them.
 */
export function protectedResetUnavailableCopy(academyId: string, owner: boolean) {
  return owner
    ? `${academyId} is the platform admin account and has no authenticator connected, so its password cannot be reset by email. It needs a manual fix by whoever looks after the portal’s hosting.`
    : `${academyId} is a protected account with no authenticator connected, so its password cannot be reset by email alone. That is only possible for 24 hours after the platform admin approves an authenticator reset sent from this recovery email. Contact the platform admin, confirm who you are, and ask them to help you back in.`
}

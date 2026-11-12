/**
 * The sign-in page's `?notice=` value for a password change that also signed
 * out the browser it was made from.
 *
 * Changing a password logs every other device out, and when the step that
 * re-signs this browser fails, it is logged out too. The security page then
 * has nobody to render for, so the news that the change worked -- and which
 * password to use now -- has to be said where the person lands instead.
 */
export const PASSWORD_CHANGED_LOGIN_NOTICE = "password-changed"

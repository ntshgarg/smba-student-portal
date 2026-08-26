import type { OperationalActionErrorCode } from "@/lib/actions/operational-result"

/**
 * Annotated with the producer's union rather than left as a bare string, so
 * renaming the code in `lib/actions/operational-result.ts` fails this file's
 * typecheck instead of silently turning every expiry back into anonymous error
 * text.
 */
const sessionExpiredCode: OperationalActionErrorCode = "SESSION_EXPIRED"

/**
 * The login page takes no return path -- `app/login/page.tsx` reads only
 * `recovered`, and `postAuthenticationDestination` decides where a signed-in
 * coach lands -- so this is the whole href. Giving it one would mean accepting
 * a destination from a query string on the one page reachable while signed out,
 * which is a redirect that page cannot currently be talked into.
 */
const signInHref = "/login"

export type RefusedSaveDescription = {
  leaveConfirmation?: string
  message: string
  signIn?: { href: string; label: string }
}

/**
 * Turns a refused save *result* into operational copy, in the same shape and
 * voice as `describeSaveFailure` in `lib/client/network-failure.ts`, which
 * covers refusals that arrive as a *throw*. `subject` names what was being
 * saved and `place` names the register in the word its own picker uses -- the
 * roll call is picked by date, the player register by session -- both supplied
 * without punctuation.
 *
 * An expired session is the one refusal carrying an action rather than a
 * correction, and it is the reason this exists. Every other code is the
 * service's own sentence about something the coach can fix on this screen; an
 * expiry cannot be fixed on this screen at all, so the message names the one
 * thing that clears it and the caller renders that as somewhere to go.
 *
 * The way back is stated as two steps because it is two. Signing in does not
 * return the coach to the register: `postAuthenticationDestination`
 * (`lib/auth/post-auth-destination.ts:11-46`) sends a head coach to
 * `/auth/two-factor/setup`, `/account/recovery-email/setup`, `/auth/pin/setup`
 * or `/coach`, and both registers are URL-backed -- `?date=` on the roll call,
 * `?date=&occurrence=` on the player register -- so the coach reopens the one
 * they were on before a save is possible at all. "Sign in again, then save"
 * described a journey nobody gets.
 *
 * `marksOnDevice` is asked rather than assumed, and asked lazily so a refusal
 * the coach can correct here does not pay for a storage scan. Both registers
 * write a draft on every mark, but `writeDraftMarks` in
 * `lib/client/attendance-draft-storage.ts` swallows a refused write -- quota
 * exhausted, blocked site data -- because a draft that cannot be stored must
 * never cost the coach the register in front of them. So the promise that the
 * marks survive leaving is only made once the draft has been read back, and
 * when it has not, the copy says what leaving actually costs.
 *
 * `leaveConfirmation` re-words the unsaved-work guard for as long as the expiry
 * stands, and is supplied only on the branch where it is true. The `Sign in`
 * link is a cross-page anchor, so `guardLinkNavigation`
 * (`components/unsaved-work-guard.tsx`) confirms on it with the surface's own
 * "discard the unsaved ... changes?" -- a sentence this notice contradicts, and
 * whose rational answer, Cancel, returns the coach to a register with a dead
 * session and no way to save, which is the state this whole path exists to get
 * them out of.
 *
 * No retry is offered with any of it. Saving again before signing in is refused
 * identically, and a button that cannot work is worse than no button when the
 * coach is courtside with a session running.
 */
export function describeRefusedSave(
  result: { code?: string; message: string },
  { marksOnDevice, place, subject }: {
    marksOnDevice: () => boolean
    place: string
    subject: string
  },
): RefusedSaveDescription {
  if (result.code !== sessionExpiredCode) return { message: result.message }

  const signIn = { href: signInHref, label: "Sign in" }

  if (!marksOnDevice()) {
    return {
      message: `${subject} was not recorded because your sign-in expired.`
        + " These marks are only on this screen and will not come back:"
        + " sign in, then mark them again.",
      signIn,
    }
  }

  return {
    leaveConfirmation: `Leave this ${place}? Your marks are kept on this device`
      + " and come back when you open it again.",
    message: `${subject} was not recorded because your sign-in expired.`
      + ` Your marks are kept on this device. Sign in, then open this ${place}`
      + " again to save.",
    signIn,
  }
}

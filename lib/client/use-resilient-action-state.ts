"use client"

import { unstable_rethrow } from "next/navigation"
import { useActionState } from "react"

import {
  classifySaveFailure,
  describeSaveFailure,
  type SaveFailureKind,
} from "@/lib/client/network-failure"

/**
 * `useActionState` has no failure channel. When the action rejects, React marks
 * the action node `"rejected"` and re-throws the thenable on the next render --
 * `onActionError` at `react-dom/cjs/react-dom-client.development.js:8454` and
 * `trackUsedThenable` at `:5958`, as vendored at react-dom 19.2.8. The throw
 * escalates to the nearest error boundary, so the form is replaced by a generic
 * error card and everything typed into it goes with the unmounted subtree.
 *
 * A dropped request is enough to trigger that; the action itself need not be
 * buggy. On the authentication surfaces the request is the whole product, so
 * this wrapper supplies the seam React does not: it catches the rejection,
 * turns it into a plain sentence about what may have happened and what to do,
 * and folds it into the state the form is rendering, so the failure arrives
 * through the existing error markup instead of through a boundary.
 *
 * It supplies that seam for faults only. A rejection Next.js threw on purpose --
 * the `redirect()` every successful sign-in ends on, and the `notFound`,
 * `forbidden` and `unauthorized` family -- is control flow the framework has to
 * receive back, so it is rethrown untouched. See the catch block.
 *
 * `pending` needs no handling of its own. React clears it when the action
 * settles, and both paths settle: a fault resolves with a folded state, and a
 * framework control error rejects on to the boundary that owns it.
 */

/** The one field every authentication action state has in common. */
type ActionErrorState = { error: string | null }

type FormAction<State> = (state: State, payload: FormData) => Promise<State>

export type ResilientActionOptions<State> = {
  /**
   * Rewrites the state on screen so it carries `message`. The default replaces
   * `error`, which is all a state needs when `error` is its only failure
   * channel. Supply one where the shape also carries a field-level verdict or a
   * success notice, neither of which may outlive the failure. `kind` says what
   * went wrong; only a `"session-expired"` is known to have changed nothing.
   */
  fold?: (state: State, message: string, kind: SaveFailureKind) => State
  /** Older name for what is still on screen; prefer `unconfirmed`. */
  retained?: string
  /** What was being submitted, as a singular noun phrase. No trailing punctuation. */
  subject: string
  /** How to find out whether it went through, true either way. No trailing punctuation. */
  unconfirmed?: string
}

function foldIntoError<State extends ActionErrorState>(state: State, message: string) {
  return { ...state, error: message }
}

/**
 * Wraps a form action so that it resolves with a folded failure instead of
 * rejecting. Exported separately from the hook so the contract can be exercised
 * without a React renderer.
 */
export function resilientAction<State extends ActionErrorState>(
  action: FormAction<State>,
  { fold = foldIntoError, ...wording }: ResilientActionOptions<State>,
): FormAction<State> {
  return async (state, payload) => {
    try {
      return await action(state, payload)
    } catch (error) {
      /*
       * Not every rejection is a failure. A Server Action that finishes with
       * `redirect()` -- which is how every action behind these forms reports
       * success -- rejects the client-side promise on purpose:
       * `serverActionReducer` calls `reject(createRedirectErrorForAction(...))`
       * before it navigates, so that React re-throws at this `useActionState`
       * and `RedirectBoundary` remounts the subtree the action has just
       * invalidated (next 16.3.1, `client/components/router-reducer/reducers/
       * server-action-reducer.js:240-263` and `client/components/
       * redirect-boundary.js:60`). `notFound`, `forbidden` and `unauthorized`
       * reach `HTTPAccessFallbackBoundary` the same way.
       *
       * Catching those was this wrapper's own bug, and it was self-concealing:
       * the reducer navigates whether or not anyone catches the rejection, so
       * sign-in still worked and nothing looked broken. What it cost was a
       * `NEXT_REDIRECT` alert flashed into the form's `role="alert"` on the way
       * out, a stale subtree carried into the next route, and a bogus
       * `unhandled_rejection` row per successful sign-in, spending the
       * reporter's eight-per-page budget on the framework's own control flow.
       * Every row in `client_error_reports` on 2026-09-07 -- all sixteen of
       * them, `Error` with a null digest, on the six auth routes whose actions
       * end in `redirect()` and nowhere else -- has this shape.
       *
       * `unstable_rethrow` is the seam Next.js documents for exactly this and
       * knows every code it owns; it must stay at the top of the block, before
       * anything treats `error` as a fault.
       */
      unstable_rethrow(error)

      return fold(state, describeUnconfirmedSubmission(error, wording), classifySaveFailure(error))
    }
  }
}

/** The sentence for a submission whose reply did not come back as an answer. */
export function describeUnconfirmedSubmission(
  error: unknown,
  { retained = "Nothing was changed", subject, unconfirmed }: Omit<ResilientActionOptions<unknown>, "fold">,
) {
  return describeSaveFailure({ error, retained, subject, unconfirmed }).message
}

type ResilientActionState<State> = [
  state: State,
  dispatch: (payload: FormData) => void,
  isPending: boolean,
]

/**
 * React types `useActionState` against `Awaited<State>`, which TypeScript
 * cannot reduce while `State` is still generic one level up. No action state in
 * this app is a thenable, so the hook is re-declared here over the state type
 * itself. This is the only place the two descriptions differ, and nothing about
 * the call changes.
 */
const useFormActionState = useActionState as unknown as <State>(
  action: FormAction<State>,
  initialState: State,
) => ResilientActionState<State>

export function useResilientActionState<State extends ActionErrorState>(
  action: FormAction<State>,
  initialState: State,
  options: ResilientActionOptions<State>,
): ResilientActionState<State> {
  return useFormActionState(resilientAction(action, options), initialState)
}

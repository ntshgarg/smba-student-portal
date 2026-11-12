/**
 * Shape shared by the registration form and the two server actions that drive
 * it. It lives here rather than in `app/login/actions.ts` because a `"use
 * server"` module may only export async functions -- exporting the empty-values
 * constant from there compiles, passes every unit test that imports the module
 * directly, and then fails at runtime the first time the form is submitted.
 */

export type RegistrationField =
  | "code"
  | "dateOfBirth"
  | "email"
  | "fullName"
  | "phone"
  | "requestedRole"

export type RegistrationValues = {
  dateOfBirth: string
  email: string
  fullName: string
  phone: string
  requestedRole: "coach" | "player"
}

export type RegistrationStanding = "new" | "pending" | "approved" | "rejected"

/**
 * Approved, set up, and no password yet: the one standing where a door can hand
 * over the password step. The registration form, the status lookup and the
 * actions behind them all ask this one question, so the two doors cannot offer
 * different next steps for the same person.
 */
export function passwordStepReachable(input: {
  activated: boolean
  onboardingCompleted: boolean
  standing: RegistrationStanding | null
}) {
  return input.standing === "approved" && input.onboardingCompleted && !input.activated
}

/**
 * `values` rides the state so a refused submit re-renders what was typed. The
 * step is explicit rather than inferred from which fields are filled, because
 * "the code was wrong" and "we have not sent one yet" look identical otherwise
 * and would bounce someone back to the start of the form.
 */
export type RegistrationFormState = {
  academyId: string | null
  /** Already has a password: offer sign-in, never "wait for your coach". */
  activated: boolean
  error: string | null
  errorField: RegistrationField | null
  onboardingCompleted: boolean
  standing: RegistrationStanding | null
  step: "details" | "code" | "done"
  values: RegistrationValues
}

export const EMPTY_REGISTRATION_VALUES: RegistrationValues = {
  dateOfBirth: "",
  email: "",
  fullName: "",
  phone: "",
  requestedRole: "player",
}

export const EMPTY_REGISTRATION_STATE: RegistrationFormState = {
  academyId: null,
  activated: false,
  error: null,
  errorField: null,
  onboardingCompleted: false,
  standing: null,
  step: "details",
  values: EMPTY_REGISTRATION_VALUES,
}

/**
 * Back from the code step to the details, with everything still typed in.
 * Before this the step only ever moved forward on a server reply, so a
 * mistyped email -- shown right there in the helper text -- could only be
 * fixed by reloading the page and typing all five fields again.
 */
export function registrationDetailsAgain(state: RegistrationFormState): RegistrationFormState {
  return {
    ...EMPTY_REGISTRATION_STATE,
    values: state.values,
  }
}

/**
 * A fresh form for the next child. The contact email and mobile are kept,
 * because siblings are registered on one address; the player's own name and
 * date of birth are cleared.
 */
export function registrationForAnotherPlayer(state: RegistrationFormState): RegistrationFormState {
  return {
    ...EMPTY_REGISTRATION_STATE,
    values: {
      ...EMPTY_REGISTRATION_VALUES,
      email: state.values.email,
      phone: state.values.phone,
    },
  }
}

/** A request the head coach rejected, as the Rejected list on the intake register shows it. */
export type RejectedRegistration = {
  contactEmail: string | null
  createdAt: string
  fullName: string
  id: string
  rejectedAt: string | null
  requestedRole: "coach" | "player"
}

/**
 * State for the status lookup on /activate. Deliberately a different shape from
 * the registration form: it collects two fields rather than five, and it never
 * creates anything, so it carries no role or date of birth to lose.
 */
export type RegistrationStatusState = {
  academyId: string | null
  /** Already has a password: offer sign-in, never the setup form. */
  activated: boolean
  error: string | null
  errorField: "code" | "email" | "fullName" | null
  fullName: string | null
  onboardingCompleted: boolean
  standing: RegistrationStanding | null
  step: "details" | "code" | "done"
  values: { email: string; fullName: string }
}

export const EMPTY_REGISTRATION_STATUS_STATE: RegistrationStatusState = {
  academyId: null,
  activated: false,
  error: null,
  errorField: null,
  fullName: null,
  onboardingCompleted: false,
  standing: null,
  step: "details",
  values: { email: "", fullName: "" },
}

/**
 * Back to the name and email, still filled in. The code step used to offer
 * nothing but "Check status", which for a mistyped address or a code past its
 * ten minutes could only ever answer "invalid or expired".
 */
export function registrationStatusDetailsAgain(
  state: RegistrationStatusState,
): RegistrationStatusState {
  return { ...EMPTY_REGISTRATION_STATUS_STATE, values: state.values }
}

/** The bare form again, keeping the email, to look up a brother or sister. */
export function registrationStatusForAnotherPlayer(
  state: RegistrationStatusState,
): RegistrationStatusState {
  return {
    ...EMPTY_REGISTRATION_STATUS_STATE,
    values: { email: state.values.email, fullName: "" },
  }
}

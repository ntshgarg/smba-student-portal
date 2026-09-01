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
 * `values` rides the state so a refused submit re-renders what was typed. The
 * step is explicit rather than inferred from which fields are filled, because
 * "the code was wrong" and "we have not sent one yet" look identical otherwise
 * and would bounce someone back to the start of the form.
 */
export type RegistrationFormState = {
  academyId: string | null
  error: string | null
  errorField: RegistrationField | null
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
  error: null,
  errorField: null,
  standing: null,
  step: "details",
  values: EMPTY_REGISTRATION_VALUES,
}

/**
 * State for the status lookup on /activate. Deliberately a different shape from
 * the registration form: it collects two fields rather than five, and it never
 * creates anything, so it carries no role or date of birth to lose.
 */
export type RegistrationStatusState = {
  academyId: string | null
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
  error: null,
  errorField: null,
  fullName: null,
  onboardingCompleted: false,
  standing: null,
  step: "details",
  values: { email: "", fullName: "" },
}

"use client"

import { FormEvent, useState } from "react"
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  MessageCircle,
} from "lucide-react"

import { formatInr } from "@/lib/format"
import {
  createTrialMessage,
  enrollmentTerms,
  programPlan,
  type Schedule,
  trainingPrograms,
  weekendPrograms,
} from "@/lib/public/academy"

const included = [
  "Courts at Just Play",
  // "a welcome kit" reads as a list item "Welcome kit"
  ...enrollmentTerms.registrationIncludes.map((item) => {
    const bare = item.replace(/^an? /u, "")
    return bare[0].toUpperCase() + bare.slice(1)
  }),
]

/**
 * The programs and their monthly guide fees in one place: a tab per level, then, for the chosen level, what
 * the player works on and their plan (schedule, days a week, and the fee those give). What every program
 * includes runs along the foot. Advanced trains on weekdays only, so it has no weekend plan.
 */
export function ProgramPlanner() {
  const [levelIndex, setLevelIndex] = useState(0)
  const [schedule, setSchedule] = useState<Schedule>("weekday")
  const [days, setDays] = useState(3)

  const level = trainingPrograms[levelIndex]
  const plan = programPlan(level.title, schedule, days)

  function chooseLevel(index: number) {
    setLevelIndex(index)
    // a level without weekends resets the schedule, so it doesn't jump back to weekend on the next level
    const title = trainingPrograms[index].title
    if (!weekendPrograms.some((program) => program.name === title)) setSchedule("weekday")
  }

  return (
    <div className="program-planner">
      <div className="program-tabs" role="group" aria-label="Program level">
        {trainingPrograms.map((program, index) => (
          <button
            key={program.title}
            type="button"
            aria-pressed={index === levelIndex}
            onClick={() => chooseLevel(index)}
          >
            <strong>{program.title}</strong>
            <span>{program.level}</span>
          </button>
        ))}
      </div>

      <div className="program-band">
        <div className="program-work">
          <p className="public-eyebrow public-eyebrow-light">You’ll work on</p>
          <ul>
            {level.outcomes.map((outcome) => (
              <li key={outcome}>
                <Check aria-hidden="true" />
                {outcome}
              </li>
            ))}
          </ul>
        </div>

        <div className="program-plan">
          <h3 className="public-eyebrow public-eyebrow-light">Your plan</h3>

          <div className="program-schedule" role="group" aria-label="Training schedule">
            <button
              type="button"
              aria-label="Weekday, Monday to Friday"
              aria-pressed={!plan.onWeekend}
              onClick={() => setSchedule("weekday")}
            >
              Weekday
              <small>Mon–Fri</small>
            </button>
            <button
              type="button"
              aria-label={plan.hasWeekend ? "Weekend, Saturday and Sunday" : "Weekend, not offered at this level"}
              aria-pressed={plan.onWeekend}
              disabled={!plan.hasWeekend}
              onClick={() => setSchedule("weekend")}
            >
              Weekend
              <small>{plan.hasWeekend ? "Sat–Sun" : "Weekdays only"}</small>
            </button>
          </div>

          {/* kept in place (unseen) on weekends, so switching schedule doesn't shift the price */}
          <div className="program-days" role="group" aria-label="Days a week" data-off={plan.onWeekend || undefined}>
            {plan.frequencies.map((frequency) => (
              <button
                key={frequency}
                type="button"
                aria-pressed={frequency === plan.daysAWeek}
                // a level with one option (Advanced) keeps the days picked for the others
                onClick={() => plan.frequencies.length > 1 && setDays(frequency)}
              >
                {frequency} days
              </button>
            ))}
          </div>

          <div className="program-result" aria-live="polite" aria-atomic="true">
            <span className="sr-only">
              {level.title}, {plan.onWeekend ? "weekends" : `weekdays, ${plan.daysAWeek} days`}:
            </span>
            <p className="program-fee">
              {/* The published guide is in whole rupees; `formatInr` takes paise. */}
              <strong>{formatInr(plan.fee * 100)}</strong>
              <span>a month</span>
            </p>
            <div className="program-facts">
              <p>
                <strong>{plan.sessions}</strong> <span>sessions a week</span>
              </p>
              <p>
                <strong>{plan.duration.replace(/ hours?$/u, " hr")}</strong> <span>each session</span>
              </p>
            </div>
          </div>

          <p className="program-fine">
            Standard guide price. Your coach confirms each member’s final monthly fee, and any special
            concession is agreed directly with the coach.
          </p>
        </div>

        <div className="program-included">
          <p className="public-eyebrow public-eyebrow-light">Included</p>
          <ul>
            {included.map((item) => (
              <li key={item}>
                <Check aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
          <p className="program-registration">
            {formatInr(enrollmentTerms.registrationFee * 100)} one-time registration, payable when you
            register{enrollmentTerms.registrationIsNonRefundable ? " and non-refundable" : ""}
          </p>
        </div>
      </div>
    </div>
  )
}

export function TrialForm() {
  const [whatsappStatus, setWhatsappStatus] = useState<
    { state: "idle" | "opened" } | { state: "blocked"; url: string }
  >({ state: "idle" })

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const name = String(form.get("name") ?? "").trim()
    if (!name) {
      const nameInput = event.currentTarget.elements.namedItem("name")
      if (nameInput instanceof HTMLInputElement) {
        nameInput.setCustomValidity("Please enter your name.")
        nameInput.reportValidity()
        nameInput.focus()
      }
      return
    }
    const url = createTrialMessage({
      name,
      level: String(form.get("level") ?? "Beginner"),
      schedule: String(form.get("schedule") ?? "Weekday"),
      callback: form.get("callback") === "on",
      note: String(form.get("note") ?? ""),
    })
    const whatsappTab = window.open(url, "_blank")

    if (whatsappTab) {
      whatsappTab.opener = null
      setWhatsappStatus({ state: "opened" })
      return
    }

    setWhatsappStatus({ state: "blocked", url })
  }

  return (
    <div className="trial-form-card">
      <form
        onSubmit={onSubmit}
        // An edit makes the prepared message out of date, so the fallback link
        // and the "opened" note go until the form is sent again.
        onChange={() => setWhatsappStatus((current) => (
          current.state === "idle" ? current : { state: "idle" }
        ))}
        aria-labelledby="trial-form-title"
      >
        <div className="form-heading">
          <h3 id="trial-form-title">Free trial request</h3>
          <MessageCircle aria-hidden="true" />
        </div>

        <div className="form-grid">
          <div className="form-field form-field-full">
            <label htmlFor="name">
              Your name <span className="form-required-mark" aria-hidden="true">*</span>
            </label>
            <input
              id="name"
              name="name"
              required
              pattern=".*\S.*"
              autoComplete="name"
              enterKeyHint="next"
              placeholder="How should we address you?"
              onInvalid={(event) => event.currentTarget.setCustomValidity("Please enter your name.")}
              onInput={(event) => event.currentTarget.setCustomValidity("")}
            />
          </div>

          <div className="form-field">
            <label htmlFor="level">Current level</label>
            <select id="level" name="level" defaultValue="Beginner">
              <option>Beginner</option>
              <option>Intermediate</option>
              <option>Advanced</option>
              <option>Adult</option>
              <option>Not sure yet</option>
            </select>
          </div>

          <div className="form-field">
            <label htmlFor="schedule">Preferred schedule</label>
            <select id="schedule" name="schedule" defaultValue="Weekday">
              <option>Weekday</option>
              <option>Weekend</option>
              <option>Either works</option>
            </select>
          </div>

          <div className="form-field form-field-full">
            <label htmlFor="note">
              Anything we should know? <span>Optional</span>
            </label>
            <textarea
              id="note"
              name="note"
              placeholder="Age, goals, previous experience or preferred time"
              rows={4}
            />
          </div>
        </div>

        <label className="callback-row">
          <input type="checkbox" name="callback" />
          <span>Ask the academy to call me back</span>
        </label>

        <button
          className="submit-button"
          type="submit"
          aria-describedby="trial-whatsapp-note"
        >
          Continue on WhatsApp
          <ArrowUpRight aria-hidden="true" />
        </button>
        <p id="trial-whatsapp-note" className="privacy-note">
          This opens WhatsApp in a new tab with your details. The website does not
          store your information or collect payment.
        </p>
        {/* the direct lines live in the footer */}
        <a className="trial-contact-link" href="#contact">
          Or contact us
          <ArrowDown aria-hidden="true" />
        </a>
        <div className="whatsapp-status-slot" aria-live="polite" aria-atomic="true">
          {whatsappStatus.state === "opened" ? (
            <p className="whatsapp-status">
              WhatsApp opened in a new tab. Send the prepared message to complete your
              request.
            </p>
          ) : null}
          {whatsappStatus.state === "blocked" ? (
            <p className="whatsapp-status whatsapp-status-blocked" role="alert">
              Your browser blocked the new tab.{" "}
              <a
                href={whatsappStatus.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open the prepared WhatsApp message in a new tab"
              >
                Open WhatsApp here
              </a>
              .
            </p>
          ) : null}
        </div>
      </form>
    </div>
  )
}

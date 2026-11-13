"use client"

import { FormEvent, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowUpRight,
  CalendarCheck,
  Check,
  MessageCircle,
} from "lucide-react"

import { formatInr } from "@/lib/format"
import {
  createTrialMessage,
  enrollmentTerms,
  weekdayPrograms,
  weekendPrograms,
} from "@/lib/public/academy"

export function PrinciplesReveal({ items }: { items: readonly string[] }) {
  const listRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    const element = listRef.current
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return
    }

    const bounds = element.getBoundingClientRect()
    if (bounds.top <= window.innerHeight * 0.72) {
      element.classList.add("is-visible")
      return
    }

    if (!("IntersectionObserver" in window)) {
      element.classList.add("is-visible")
      return
    }

    element.classList.add("is-reveal-ready")
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        element.classList.add("is-visible")
        observer.disconnect()
      },
      { threshold: 0.35 },
    )

    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <ol
      ref={listRef}
      className="about-principles"
    >
      {items.map((item, index) => (
        <li key={item}>
          <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
          <p>{item}</p>
        </li>
      ))}
    </ol>
  )
}

export function FeeExplorer() {
  const [schedule, setSchedule] = useState<"weekday" | "weekend">("weekday")
  const programs = schedule === "weekday" ? weekdayPrograms : weekendPrograms
  const [programName, setProgramName] = useState<string>("Beginner")
  const selected = programs.find((program) => program.name === programName) ?? programs[0]

  const frequencies = useMemo(() => {
    if (schedule === "weekend" || !("fees" in selected)) {
      return [] as number[]
    }
    return Object.keys(selected.fees).map(Number)
  }, [schedule, selected])

  const [days, setDays] = useState(3)
  const effectiveDays =
    frequencies.includes(days) && frequencies.length > 0 ? days : frequencies[0]

  const price =
    schedule === "weekend"
      ? "fee" in selected
        ? selected.fee
        : 0
      : "fees" in selected
        ? selected.fees[effectiveDays as 3 | 4 | 5] ?? 0
        : 0

  const scheduleLabel = schedule === "weekday" ? "Weekday" : "Weekend"
  const sessionsPerWeek = schedule === "weekday" ? effectiveDays : 2

  function chooseSchedule(next: "weekday" | "weekend") {
    setSchedule(next)
    setProgramName("Beginner")
    setDays(next === "weekday" ? 3 : 2)
  }

  return (
    <div className="fee-explorer">
      <div className="fee-copy">
        <p className="public-eyebrow public-eyebrow-light">Monthly fee guide</p>
        <h3 id="fee-guide-title">Choose your training rhythm.</h3>
        <p>
          These standard guide prices are based on programme and schedule. Your coach
          confirms each member’s final monthly fee directly.
        </p>
      </div>

      <section className="fee-panel" aria-labelledby="fee-guide-title" aria-describedby="fee-helper">
        <p id="fee-helper" className="fee-helper">
          Select your schedule and program to view the standard monthly fee guide.
        </p>

        <div className="segmented" role="group" aria-label="Training schedule">
          <button
            type="button"
            aria-pressed={schedule === "weekday"}
            onClick={() => chooseSchedule("weekday")}
          >
            <span>
              Weekday
              <small>Mon–Fri</small>
            </span>
            {schedule === "weekday" ? <Check aria-hidden="true" /> : null}
          </button>
          <button
            type="button"
            aria-pressed={schedule === "weekend"}
            onClick={() => chooseSchedule("weekend")}
          >
            <span>
              Weekend
              <small>Sat–Sun</small>
            </span>
            {schedule === "weekend" ? <Check aria-hidden="true" /> : null}
          </button>
        </div>

        <fieldset className="fee-field">
          <legend className="fee-label">Program</legend>
          <div className="choice-row">
            {programs.map((program) => (
              <button
                key={program.name}
                type="button"
                aria-pressed={program.name === selected.name}
                onClick={() => {
                  setProgramName(program.name)
                  if ("fees" in program) {
                    setDays(Number(Object.keys(program.fees)[0]))
                  }
                }}
              >
                {program.name === selected.name ? <Check aria-hidden="true" /> : null}
                {program.name}
              </button>
            ))}
          </div>
        </fieldset>

        {schedule === "weekday" ? (
          <fieldset className="fee-field">
            <legend className="fee-label">Frequency</legend>
            <div className="choice-row">
              {frequencies.map((frequency) => (
                <button
                  key={frequency}
                  type="button"
                  aria-pressed={frequency === effectiveDays}
                  onClick={() => setDays(frequency)}
                >
                  {frequency === effectiveDays ? <Check aria-hidden="true" /> : null}
                  {frequency} days
                </button>
              ))}
            </div>
          </fieldset>
        ) : null}

        <div className="price-result-shell" aria-live="polite">
          <div
            className="price-result"
            key={`${schedule}-${selected.name}-${sessionsPerWeek}`}
          >
            <div>
              <span>Standard guide · {scheduleLabel} {selected.name}</span>
              <small>
                {sessionsPerWeek} sessions/week · {selected.duration} each
              </small>
            </div>
            <strong>
              {/* The published guide is in whole rupees; `formatInr` takes paise. */}
              {formatInr(price * 100)}
              <small>/month</small>
            </strong>
          </div>
        </div>

        <div className="term-savings">
          <p className="term-savings-label">Coach-agreed fee</p>
          <span>
            Any special concession is agreed directly with the coach for the individual member.
          </span>
        </div>

        <p className="fee-note">
          One-time academy registration fee: {formatInr(enrollmentTerms.registrationFee * 100)}, payable
          when you register{enrollmentTerms.registrationIsNonRefundable ? " and non-refundable." : "."}{" "}
          Includes {enrollmentTerms.registrationIncludes.join(" and ")}.
        </p>
      </section>
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

        <p className="form-reassurance">
          <CalendarCheck aria-hidden="true" />
          A coach will reply on WhatsApp to confirm availability and a suitable session
          time.
        </p>

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

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

export function FlightLineVisual() {
  return (
    <div className="hero-visual" aria-hidden="true">
      <svg
        className="badminton-scene"
        viewBox="0 0 720 720"
        fill="none"
      >
        <defs>
          <linearGradient
            id="trajectory-taper"
            x1="163"
            y1="469"
            x2="501"
            y2="226"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="var(--red)" stopOpacity="0.96" />
            <stop offset="70%" stopColor="var(--red)" stopOpacity="0.9" />
            <stop offset="91%" stopColor="var(--red)" stopOpacity="0.38" />
            <stop offset="100%" stopColor="var(--red)" stopOpacity="0.04" />
          </linearGradient>
          <linearGradient
            id="trajectory-guide-taper"
            x1="163"
            y1="469"
            x2="501"
            y2="226"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="var(--red)" stopOpacity="0.46" />
            <stop offset="74%" stopColor="var(--red)" stopOpacity="0.34" />
            <stop offset="100%" stopColor="var(--red)" stopOpacity="0" />
          </linearGradient>
          <clipPath id="racket-head-clip" clipPathUnits="userSpaceOnUse">
            <ellipse cx="162" cy="475" rx="52" ry="70" />
          </clipPath>
        </defs>

        <g className="court-outline">
          <path d="M206 198H526L654 620H74L206 198Z" />
          <path d="M228 198L126 620" />
          <path d="M504 198L602 620" />
          <path d="M196 235H538" />
          <path d="M158 348H573" />
          <path d="M119 488H616" />
          <path d="M89 571H639" />
          <path d="M366 198V348" />
          <path d="M366 488V620" />
        </g>

        <g className="court-net">
          <path d="M137 365H596" />
          <path d="M143 428H590" />
          <path d="M137 365L143 428" />
          <path d="M596 365L590 428" />
          <path d="M188 365L192 428M239 365L241 428M290 365L291 428" />
          <path d="M341 365L341 428M392 365L391 428M443 365L441 428" />
          <path d="M494 365L491 428M545 365L541 428" />
          <path d="M140 386H593M142 407H591" />
          <path className="net-post" d="M128 350V447M606 350V447" />
        </g>

        <g className="racket-illustration" transform="rotate(-38 162 475)">
          <ellipse className="racket-head" cx="162" cy="475" rx="52" ry="70" />
          <g className="racket-strings" clipPath="url(#racket-head-clip)">
            <path d="M118 398V552M129 398V552M140 398V552M151 398V552M162 398V552M173 398V552M184 398V552M195 398V552M206 398V552" />
            <path d="M102 415H222M102 426H222M102 437H222M102 448H222M102 459H222M102 470H222M102 481H222M102 492H222M102 503H222M102 514H222M102 525H222M102 536H222" />
          </g>
          <path className="racket-t-joint" d="M153 542Q162 549 171 542M162 547V557" />
          <path className="racket-shaft" d="M162 554V628" />
          <path className="racket-grip" d="M162 619V674" />
          <path className="racket-grip-bands" d="M157 630L167 626M157 640L167 636M157 650L167 646M157 660L167 656" />
        </g>

        <path
          className="trajectory-guide"
          d="M163 469C230 202 365 108 501 226"
          stroke="url(#trajectory-guide-taper)"
        />
        <path
          className="shuttle-trajectory"
          d="M163 469C230 202 365 108 501 226"
          stroke="url(#trajectory-taper)"
          strokeWidth="3.25"
          strokeLinecap="round"
          pathLength="1"
        />

        <g className="shuttle-illustration" transform="translate(501 226) rotate(-12)">
          <g transform="scale(0.7) translate(-56 -114)">
            <path
              className="shuttle-feather-shell"
              d="M9 18C20 9 36 4 56 4C76 4 92 9 103 18L70 80Q56 88 42 80L9 18Z"
            />
            <g className="shuttle-feather-ribs">
              <path d="M9 18L42 80M23 10L46 82M39 5L51 84M56 4V85M73 6L61 84M89 11L66 82M103 18L70 80" />
            </g>
            <g className="shuttle-skirt-bands">
              <path d="M25 49Q56 41 87 49" />
              <path d="M34 66Q56 59 78 66" />
            </g>
            <path className="shuttle-binding" d="M41 78Q56 73 71 78L70 86Q56 91 42 86L41 78Z" />
            <path className="shuttle-cork" d="M42 85Q56 81 70 85L71 98Q69 109 56 114Q43 109 41 98L42 85Z" />
            <path className="shuttle-cork-seam" d="M42 92Q56 97 70 92" />
          </g>
        </g>

        <circle className="contact-ring" cx="163" cy="469" r="12" />
        <circle className="contact-dot" cx="163" cy="469" r="3.5" />
      </svg>
      <div className="hero-visual-note">
        <span>SMBA · 01</span>
        <p>
          Technique
          <br />
          Movement
          <br />
          Mindset
        </p>
      </div>
    </div>
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
      <form onSubmit={onSubmit} aria-labelledby="trial-form-title">
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

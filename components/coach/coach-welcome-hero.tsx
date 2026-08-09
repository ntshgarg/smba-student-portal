"use client"

import { ArrowDown } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"

export function CoachWelcomeHero({
  coachName,
  dateLabel,
  dateTime,
  greeting,
  upcomingSession,
  sessionCount,
  sessionPosition,
}: {
  coachName: string
  dateLabel: string
  dateTime: string
  greeting: string
  upcomingSession: {
    time: string
    title: string
    venue: string
  } | null
  sessionCount: number
  sessionPosition: "first" | "next"
}) {
  const reduceMotion = useReducedMotion()
  const initial = reduceMotion
    ? false
    : { opacity: 0, transform: "translateY(16px)" }
  const animate = { opacity: 1, transform: "translateY(0px)" }

  return (
    <section className="welcome-hero coach-welcome-hero" aria-labelledby="coach-welcome-title">
      <svg
        className="welcome-court"
        viewBox="0 0 920 680"
        fill="none"
        aria-hidden="true"
      >
        <path d="M288 86H642L822 620H98L288 86Z" />
        <path d="M308 86L166 620M622 86L752 620M217 470H709M256 320H670M460 86V320M460 470V620" />
        <path className="welcome-net" d="M210 350H714M218 427H706M210 350L218 427M714 350L706 427" />
      </svg>

      <div className="welcome-inner">
        <motion.div
          className="welcome-copy coach-welcome-copy"
          initial={initial}
          animate={animate}
          transition={{ duration: reduceMotion ? 0 : 0.38, ease: "easeOut" }}
        >
          <h1 id="coach-welcome-title">
            {greeting},
            <br />
            <em>{coachName}.</em>
          </h1>
          <p className="welcome-line coach-welcome-line">
            Ready to set the tone?
          </p>
        </motion.div>

        <motion.aside
          className="coach-message-card coach-welcome-card"
          aria-label="Today’s training overview"
          initial={initial}
          animate={animate}
          transition={{
            duration: reduceMotion ? 0 : 0.38,
            delay: reduceMotion ? 0 : 0.1,
            ease: "easeOut",
          }}
        >
          <div>
            <span>Today’s training</span>
            <time dateTime={dateTime}>{dateLabel}</time>
          </div>
          {upcomingSession ? (
            <>
              <dl className="coach-briefing-metrics">
                <div className="coach-briefing-metric">
                  <dt>{sessionCount === 1 ? "Session today" : "Sessions today"}</dt>
                  <dd>{sessionCount}</dd>
                </div>
                <div className="coach-briefing-metric">
                  <dt>{sessionPosition === "first" ? "First batch" : "Next batch"}</dt>
                  <dd>{upcomingSession.time}</dd>
                </div>
              </dl>
              <div className="coach-welcome-session">
                <span>{sessionPosition === "first" ? "First on court" : "Next on court"}</span>
                <strong>{upcomingSession.title}</strong>
                <p>{upcomingSession.venue}</p>
              </div>
            </>
          ) : (
            <p className="coach-welcome-empty">
              {sessionCount ? "No more sessions today." : "No sessions scheduled today."}
            </p>
          )}
        </motion.aside>

        <a className="scroll-cue" href="#attendance">
          <span>Today’s attendance</span>
          <ArrowDown aria-hidden="true" />
        </a>
      </div>
    </section>
  )
}

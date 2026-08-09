"use client"

import { ArrowDown } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"

import type { StudentIdentity } from "@/lib/auth/identity"
import type { CoachMessage } from "@/lib/types"

export function WelcomeHero({
  student,
  coachMessage,
  greeting,
  scrollLabel,
}: {
  student: StudentIdentity
  coachMessage: CoachMessage
  greeting: string
  scrollLabel: string
}) {
  const reduceMotion = useReducedMotion()

  const initial = reduceMotion
    ? false
    : { opacity: 0, transform: "translateY(16px)" }
  const animate = { opacity: 1, transform: "translateY(0px)" }

  return (
    <section className="welcome-hero" aria-labelledby="welcome-title">
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
          className="welcome-copy"
          initial={initial}
          animate={animate}
          transition={{ duration: reduceMotion ? 0 : 0.38, ease: "easeOut" }}
        >
          <p className="eyebrow eyebrow-light">Your training, in one place</p>
          <h1 id="welcome-title">
            {greeting},
            <br />
            <em>{student.firstName}.</em>
          </h1>
          <p className="welcome-line">Ready for your next point?</p>
        </motion.div>

        <motion.aside
          className="coach-message-card"
          aria-label={`Message from ${coachMessage.coachName}`}
          initial={initial}
          animate={animate}
          transition={{
            duration: reduceMotion ? 0 : 0.38,
            delay: reduceMotion ? 0 : 0.1,
            ease: "easeOut",
          }}
        >
          <div>
            <span>From {coachMessage.coachName}</span>
          </div>
          <blockquote>“{coachMessage.message}”</blockquote>
        </motion.aside>

        <a className="scroll-cue" href="#training-week">
          <span>{scrollLabel}</span>
          <ArrowDown aria-hidden="true" />
        </a>
      </div>
    </section>
  )
}

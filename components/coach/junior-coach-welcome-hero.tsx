"use client"

import { ArrowDown } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"

export function JuniorCoachWelcomeHero({
  coachName,
  greeting,
}: {
  coachName: string
  greeting: string
}) {
  const reduceMotion = useReducedMotion()
  const initial = reduceMotion
    ? false
    : { opacity: 0, transform: "translateY(16px)" }

  return (
    <section
      className="welcome-hero coach-welcome-hero junior-coach-welcome-hero"
      aria-labelledby="junior-coach-welcome-title"
    >
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
          animate={{ opacity: 1, transform: "translateY(0px)" }}
          transition={{ duration: reduceMotion ? 0 : 0.38, ease: "easeOut" }}
        >
          <h1 id="junior-coach-welcome-title">
            {greeting},
            <br />
            <em>{coachName}.</em>
          </h1>
          <p className="welcome-line coach-welcome-line">
            Your attendance record stays quietly in view.
          </p>
        </motion.div>

        <a className="scroll-cue" href="#coach-attendance">
          <span>Your attendance</span>
          <ArrowDown aria-hidden="true" />
        </a>
      </div>
    </section>
  )
}

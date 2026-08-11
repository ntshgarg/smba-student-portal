"use client"

import { ArrowDown } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"

import styles from "./junior-coach-dashboard.module.css"

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
      className={`welcome-hero welcome-scoreboard coach-welcome-hero coach-welcome-scoreboard junior-coach-welcome-hero ${styles.hero}`}
      aria-labelledby="junior-coach-welcome-title"
    >
      <svg
        className="welcome-court welcome-scoreboard-court coach-scoreboard-court"
        viewBox="0 0 1340 610"
        fill="none"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        <rect x="20" y="20" width="1300" height="570" />
        <path d="M20 63H1320M20 547H1320M94 20V590M478 20V590M862 20V590M1246 20V590M20 305H478M862 305H1320" />
        <path className="welcome-scoreboard-net coach-court-net" d="M670 20V590" />
      </svg>

      <div className={`welcome-inner ${styles.heroInner}`}>
        <motion.div
          className={`welcome-copy coach-welcome-copy ${styles.heroCopy}`}
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

import { ArrowDown } from "lucide-react"

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
  return (
    <section
      className="welcome-hero welcome-scoreboard coach-welcome-scoreboard player-welcome-scoreboard"
      aria-labelledby="welcome-title"
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

      <div className="welcome-inner">
        <div className="welcome-copy coach-welcome-copy player-welcome-copy">
          <h1 id="welcome-title">
            {greeting},
            <br />
            <em>{student.firstName}.</em>
          </h1>
          <p className="welcome-line coach-welcome-line">Ready for your next point?</p>
        </div>

        <aside
          className="coach-message-card coach-welcome-card welcome-scoreboard-ribbon coach-scoreboard-ribbon player-scoreboard-ribbon is-empty"
          aria-label={`Message from ${coachMessage.coachName}`}
        >
          <div className="player-scoreboard-message">
            <span>From {coachMessage.coachName}</span>
            <blockquote>“{coachMessage.message}”</blockquote>
          </div>
        </aside>

        <a className="scroll-cue" href="#training-week">
          <span>{scrollLabel}</span>
          <ArrowDown aria-hidden="true" />
        </a>
      </div>
    </section>
  )
}

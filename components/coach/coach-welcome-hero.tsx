import { ArrowDown } from "lucide-react"

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
  return (
    <section
      className="welcome-hero welcome-scoreboard coach-welcome-hero coach-welcome-scoreboard"
      aria-labelledby="coach-welcome-title"
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
        <div className="welcome-copy coach-welcome-copy">
          <h1 id="coach-welcome-title">
            {greeting},
            <br />
            <em>{coachName}.</em>
          </h1>
          <p className="welcome-line coach-welcome-line">
            Ready to set the tone?
          </p>
        </div>

        <aside
          className={`coach-message-card coach-welcome-card welcome-scoreboard-ribbon coach-scoreboard-ribbon ${
            upcomingSession ? "has-session" : "is-empty"
          }`}
          aria-label="Today’s training overview"
        >
          <div className="welcome-scoreboard-date coach-ribbon-date">
            <span>Today’s training</span>
            <time dateTime={dateTime}>{dateLabel}</time>
          </div>
          {upcomingSession ? (
            <>
              <dl className="coach-briefing-metrics">
                <div className="coach-briefing-metric coach-session-count-metric">
                  <dt>{sessionCount === 1 ? "Session today" : "Sessions today"}</dt>
                  <dd>{sessionCount}</dd>
                </div>
                <div className="coach-briefing-metric coach-time-metric">
                  <dt>{sessionPosition === "first" ? "First session" : "Next session"}</dt>
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
        </aside>

        <a className="scroll-cue" href="#attendance">
          <span>Today’s attendance</span>
          <ArrowDown aria-hidden="true" />
        </a>
      </div>
    </section>
  )
}

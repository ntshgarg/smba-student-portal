import { ArrowLeft } from "lucide-react"
import Link from "next/link"

import styles from "@/components/assessments/assessments.module.css"
import type { AssessmentHomePlayer } from "@/lib/assessments/queries"
import {
  describeDaysAgo,
  formatAssessmentDate,
} from "@/lib/assessments/display"
import { formatRating } from "@/lib/assessments/rubric"

function assessHref(player: AssessmentHomePlayer) {
  return player.draft
    ? `/coach/assessments/${player.draft.id}`
    : `/coach/assessments/new?player=${encodeURIComponent(player.playerId)}`
}

export function AssessmentHome({
  drafts,
  players,
  today,
}: {
  drafts: number
  players: AssessmentHomePlayer[]
  today: string
}) {
  const neverAssessed = players.filter((player) => !player.lastAssessedOn).length

  return (
    <div className={`${styles.page} page-shell`}>
      <div className={styles.backRow}>
        <Link href="/coach">
          <ArrowLeft aria-hidden="true" />
          Back to dashboard
        </Link>
      </div>

      <header className={styles.header}>
        <div>
          <span className="eyebrow">Player development</span>
          <h1>Assessments</h1>
          <p>Assess a player whenever you choose. Players see an assessment only once you publish it.</p>
        </div>
        {players.length > 0
          ? (
            <Link className={`${styles.button} ${styles.primary}`} href="/coach/assessments/new">
              New assessment
            </Link>
          )
          : null}
      </header>

      <div className={styles.homeGrid}>
        <aside className={`${styles.card} ${styles.panel}`} aria-label="At a glance">
          <span className={styles.label}>At a glance</span>
          <dl className={styles.stats}>
            <div><dt>Players</dt><dd>{players.length}</dd></div>
            <div><dt>Never assessed</dt><dd>{neverAssessed}</dd></div>
            <div><dt>Drafts</dt><dd>{drafts}</dd></div>
          </dl>
          {drafts > 0
            ? (
              <p className={styles.draftNote}>
                {drafts === 1 ? "1 draft is" : `${drafts} drafts are`} not published yet. Choose Continue beside the player to finish.
              </p>
            )
            : null}
        </aside>

        <section className={`${styles.card} ${styles.panel}`} aria-labelledby="assessment-players-title">
          <div className={styles.listHead}>
            <div>
              <span className={styles.label}>Players</span>
              <h2 id="assessment-players-title">Who to assess next</h2>
            </div>
            <span className={styles.sortNote}>Longest since last assessed first</span>
          </div>

          {players.length === 0
            ? <p className={styles.empty}>No active players yet. They appear here once they are enrolled.</p>
            : (
              <ul className={styles.rows}>
                {players.map((player) => (
                  <li className={styles.row} key={player.playerId}>
                    <span className={styles.avatar} aria-hidden="true">{player.initials}</span>
                    <div>
                      <span className={styles.rowName}>
                        {player.name}
                        {player.draft ? <span className={styles.tag}>Draft</span> : null}
                        {!player.lastAssessedOn && !player.draft ? <span className={`${styles.tag} ${styles.tagQuiet}`}>New</span> : null}
                      </span>
                      {player.group ? <span className={styles.rowMeta}>{player.group}</span> : null}
                    </div>
                    <div className={styles.rowWhen}>
                      {player.lastAssessedOn
                        ? (
                          <>
                            <strong>{formatAssessmentDate(player.lastAssessedOn)}</strong>
                            <span className={styles.rowMeta}>
                              {describeDaysAgo(player.lastAssessedOn, today)}
                              {player.lastOverall !== null ? ` · ${formatRating(player.lastOverall)} / 5` : ""}
                            </span>
                          </>
                        )
                        : (
                          <>
                            <strong>Never assessed</strong>
                            <span className={styles.rowMeta}>No history yet</span>
                          </>
                        )}
                    </div>
                    <div className={styles.rowActions}>
                      {player.lastAssessedOn
                        ? (
                          <Link className={styles.textLink} href={`/coach/assessments/players/${player.playerId}`}>
                            History
                          </Link>
                        )
                        : null}
                      <Link className={styles.button} href={assessHref(player)}>
                        {player.draft ? "Continue" : "Assess"}
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
        </section>
      </div>

      <p className={styles.footLink}>
        Looking for an older monthly report? <Link href="/coach/reports">Open the monthly reports</Link>.
      </p>
    </div>
  )
}

export function AssessmentPlayerPicker({ players }: { players: AssessmentHomePlayer[] }) {
  return (
    <div className={`${styles.page} page-shell`}>
      <div className={styles.backRow}>
        <Link href="/coach/assessments">
          <ArrowLeft aria-hidden="true" />
          All assessments
        </Link>
      </div>

      <header className={styles.header}>
        <div>
          <span className="eyebrow">New assessment</span>
          <h1>Choose a player</h1>
        </div>
      </header>

      <section className={`${styles.card} ${styles.panel}`} style={{ marginTop: 40 }} aria-label="Players">
        {players.length === 0
          ? <p className={styles.empty}>No active players yet.</p>
          : (
            <ul className={styles.rows} style={{ marginTop: 0 }}>
              {players.map((player) => (
                <li className={styles.row} key={player.playerId}>
                  <span className={styles.avatar} aria-hidden="true">{player.initials}</span>
                  <div>
                    <span className={styles.rowName}>
                      {player.name}
                      {player.draft ? <span className={styles.tag}>Draft</span> : null}
                    </span>
                    {player.group ? <span className={styles.rowMeta}>{player.group}</span> : null}
                  </div>
                  <div className={styles.rowWhen}>
                    <span className={styles.rowMeta}>
                      {player.lastAssessedOn ? `Last assessed ${formatAssessmentDate(player.lastAssessedOn)}` : "Never assessed"}
                    </span>
                  </div>
                  <div className={styles.rowActions}>
                    <Link className={styles.button} href={assessHref(player)}>
                      {player.draft ? "Continue" : "Assess"}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
      </section>
    </div>
  )
}

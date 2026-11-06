import styles from "./reveal.module.css"

/**
 * `order` is the card's place in its group: each step waits one
 * --stagger-step (30ms) longer than the one before, so a dashboard settles
 * card by card in reading order instead of all at once.
 */
export function Reveal({
  children,
  className,
  order = 0,
}: {
  children: React.ReactNode
  className?: string
  order?: number
}) {
  return (
    <div
      className={className ? `${styles.reveal} ${className}` : styles.reveal}
      style={order ? ({ "--reveal-order": order } as React.CSSProperties) : undefined}
    >
      {children}
    </div>
  )
}

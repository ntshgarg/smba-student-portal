import styles from "./icon-swap.module.css"

/**
 * Two icons in one slot that cross-fade when `active` flips: the outgoing one
 * shrinks, blurs and fades while the incoming one grows into focus over the
 * same frames, so the new state arrives as the old one leaves instead of after
 * it. Both stay mounted, which is what lets the swap reverse cleanly when the
 * control is pressed twice in quick succession.
 *
 * Purely decorative: the wrapper is aria-hidden, so the control that holds it
 * still has to name its state (aria-label, aria-pressed, aria-expanded).
 */
export function IconSwap({
  active,
  on,
  off,
  className,
}: {
  /** True shows `on`, false shows `off`. */
  active: boolean
  on: React.ReactNode
  off: React.ReactNode
  className?: string
}) {
  return (
    <span className={className ? `${styles.swap} ${className}` : styles.swap} aria-hidden="true">
      <span className={styles.icon} data-shown={active ? "true" : "false"}>{on}</span>
      <span className={styles.icon} data-shown={active ? "false" : "true"}>{off}</span>
    </span>
  )
}

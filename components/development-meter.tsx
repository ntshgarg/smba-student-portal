import type { DevelopmentMarker } from "@/lib/types"

export function DevelopmentMeter({ marker }: { marker: DevelopmentMarker }) {
  return (
    <article className="development-meter">
      <div className="development-meter-heading">
        <div>
          <p>{marker.label}</p>
          <span>{marker.stage}</span>
        </div>
        <strong>{marker.value}%</strong>
      </div>
      <div
        className="development-track"
        role="progressbar"
        aria-label={`${marker.label}: ${marker.stage}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={marker.value}
      >
        <span style={{ width: `${marker.value}%` }} />
      </div>
      <p>{marker.note}</p>
    </article>
  )
}

import type { HistoryGpsSample, HistoryMarker, HistoryRange, LiveStateEvent } from 'vescape-core'

export type LiveTrailShape = GeoJSON.Feature<GeoJSON.MultiLineString>
interface Scope {
  recordingId: string
  boardId: string
  startedAt: number
}
interface TrailSnapshot {
  active: boolean
  shape: LiveTrailShape | null
}
const QUERY_WINDOW_MS = 5 * 60_000
const FLUSH_OVERLAP_MS = 60_000
const GAP_MS = 30_000

/** Render only native's persisted, precision/privacy-filtered track, never the raw GPS buffer. */
export function recordedTrailShape(
  points: HistoryGpsSample[],
  markers: HistoryMarker[],
): LiveTrailShape | null {
  const breaks = markers
    .filter((marker) =>
      ['auto_pause', 'gap', 'connection_lost', 'disconnected'].includes(marker.type),
    )
    .map((marker) => marker.occurredAtMs)
    .sort((a, b) => a - b)
  const coordinates: [number, number][][] = []
  let segment: [number, number][] = []
  let previous: HistoryGpsSample | undefined
  let breakIndex = 0
  for (const point of points) {
    while (breakIndex < breaks.length && previous && breaks[breakIndex] <= previous.capturedAtMs) {
      breakIndex++
    }
    const interrupted =
      previous &&
      (point.capturedAtMs - previous.capturedAtMs > GAP_MS ||
        (breakIndex < breaks.length && breaks[breakIndex] <= point.capturedAtMs))
    if (interrupted) {
      if (segment.length > 1) coordinates.push(segment)
      segment = []
    }
    segment.push([point.longitude, point.latitude])
    previous = point
  }
  if (segment.length > 1) coordinates.push(segment)
  return coordinates.length
    ? { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates } }
    : null
}

/** Native owns the route. JS retains a projection between reads, independent of the chart window. */
export function createRecordedLiveTrail(
  read: (options: {
    fromMs: number
    toMs: number
    boardId: string
    recordingId: string
    limit: number
  }) => Promise<HistoryRange>,
  publish: (snapshot: TrailSnapshot) => void,
) {
  let scope: Scope | null = null
  let active = false
  let generation = 0
  let pendingGeneration: number | null = null
  let through: number | null = null
  let points: HistoryGpsSample[] = []
  let markers: HistoryMarker[] = []
  return {
    setRecording(recording: LiveStateEvent['recording']) {
      const next =
        recording.enabled &&
        recording.recordingId &&
        recording.activeBoardId &&
        recording.startedAt != null
          ? {
              recordingId: recording.recordingId,
              boardId: recording.activeBoardId,
              startedAt: recording.startedAt,
            }
          : null
      if (
        active === recording.enabled &&
        scope?.recordingId === next?.recordingId &&
        scope?.boardId === next?.boardId &&
        scope?.startedAt === next?.startedAt
      )
        return false
      generation++
      scope = next
      active = recording.enabled
      through = null
      points = []
      markers = []
      publish({ active, shape: null })
      return true
    },
    async refresh(now: number) {
      if (!scope || pendingGeneration === generation) return
      const request = generation
      const current = scope
      pendingGeneration = request
      // A fresh cached GPS fix can precede recording start by a second or two. Native attached
      // it to this recording, so include the lead-in; exact board/recording identity remains the
      // boundary, rather than dropping legitimate first points based on their GPS clock.
      const from = Math.max(0, (through ?? current.startedAt) - FLUSH_OVERLAP_MS)
      const recovered: HistoryGpsSample[] = []
      const recoveredMarkers: HistoryMarker[] = []
      try {
        // GPS is independently capped by native. Small time windows avoid truncating long rides;
        // limit=1 avoids transferring telemetry charts we do not use here.
        for (let start = from; start <= now; start += QUERY_WINDOW_MS) {
          const range = await read({
            fromMs: start,
            toMs: Math.min(now, start + QUERY_WINDOW_MS - 1),
            boardId: current.boardId,
            recordingId: current.recordingId,
            limit: 1,
          })
          if (request !== generation) return
          recovered.push(
            ...range.gpsSamples.filter(
              (point) =>
                point.recordingId === current.recordingId &&
                point.boardId === current.boardId &&
                point.capturedAtMs >= from &&
                point.capturedAtMs <= now,
            ),
          )
          recoveredMarkers.push(...range.markers)
        }
        const byId = new Map(
          points.filter((point) => point.capturedAtMs < from).map((point) => [point.id, point]),
        )
        for (const point of recovered) byId.set(point.id, point)
        points = [...byId.values()].sort((a, b) => a.capturedAtMs - b.capturedAtMs)
        markers = [...markers.filter((marker) => marker.occurredAtMs < from), ...recoveredMarkers]
        through = now
        publish({ active, shape: recordedTrailShape(points, markers) })
      } finally {
        if (pendingGeneration === request) pendingGeneration = null
      }
    },
    dispose() {
      generation++
    },
  }
}

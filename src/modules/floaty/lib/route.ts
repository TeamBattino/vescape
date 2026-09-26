import type { PrivacyZone } from 'vescape-core'
import type { FloatySession, UploadSource } from './types'
export type Coordinate = [number, number] // longitude, latitude
export function encodePolyline(points: Coordinate[]): string {
  let lat = 0,
    lng = 0,
    result = ''
  function encode(delta: number) {
    let value = delta < 0 ? ~(delta << 1) : delta << 1
    let text = ''
    while (value >= 32) {
      text += String.fromCharCode((32 | (value & 31)) + 63)
      value >>>= 5
    }
    return text + String.fromCharCode(value + 63)
  }
  for (const [longitude, latitude] of points) {
    const nextLat = Math.round(latitude * 1e5),
      nextLng = Math.round(longitude * 1e5)
    result += encode(nextLat - lat) + encode(nextLng - lng)
    lat = nextLat
    lng = nextLng
  }
  return result
}
export function decodePolyline(polyline: string): Coordinate[] {
  if (polyline.length > 900_000) throw new Error('This Floaty route is too large to display.')
  let index = 0,
    lat = 0,
    lng = 0
  const points: Coordinate[] = []
  function next() {
    let result = 0,
      shift = 0,
      byte: number
    do {
      if (index >= polyline.length || shift > 30)
        throw new Error('Floaty returned a malformed route.')
      byte = polyline.charCodeAt(index++) - 63
      if (byte < 0 || byte > 63) throw new Error('Floaty returned a malformed route.')
      result |= (byte & 31) << shift
      shift += 5
    } while (byte >= 32)
    return result & 1 ? ~(result >>> 1) : result >>> 1
  }
  while (index < polyline.length) {
    lat += next()
    lng += next()
    if (Math.abs(lat / 1e5) > 90 || Math.abs(lng / 1e5) > 180)
      throw new Error('Floaty returned an invalid coordinate.')
    points.push([lng / 1e5, lat / 1e5])
  }
  return points
}
/** Reads only our native GPX export, which streams every precise stored track point. */
export function coordinatesFromGpx(gpx: string): Coordinate[] {
  const points: Coordinate[] = []
  for (const match of gpx.matchAll(/<trkpt lat="([^"<>]+)" lon="([^"<>]+)">/g)) {
    const latitude = Number(match[1]),
      longitude = Number(match[2])
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    ) {
      throw new Error('The ride contains an invalid GPS coordinate.')
    }
    points.push([longitude, latitude])
  }
  if (points.length < 2)
    throw new Error('This ride needs at least two recorded GPS points to upload.')
  return points
}
function distanceToZone(point: Coordinate, zone: PrivacyZone) {
  const rad = Math.PI / 180
  const dLat = (point[1] - zone.centerLatitude) * rad
  const dLng = (point[0] - zone.centerLongitude) * rad
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(point[1] * rad) * Math.cos(zone.centerLatitude * rad) * Math.sin(dLng / 2) ** 2
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)))
}
/** Split masked routes using Floaty's semicolon-separated polyline format. */
export function protectRoute(points: Coordinate[], zones: PrivacyZone[]): Coordinate[][] {
  const active = zones.filter((zone) => zone.enabled)
  const hidden = (p: Coordinate) =>
    active.some((zone) => distanceToZone(p, zone) <= zone.radiusMeters + 25)
  const intersects = (a: Coordinate, b: Coordinate) =>
    active.some((zone) => {
      // Local tangent-plane projection is accurate at privacy-zone scale. Wrap across the dateline.
      const wrap = (degrees: number) => ((degrees + 540) % 360) - 180
      const x = (lng: number) =>
        ((wrap(lng - zone.centerLongitude) * Math.PI) / 180) *
        6_371_000 *
        Math.cos((zone.centerLatitude * Math.PI) / 180)
      const y = (lat: number) => (((lat - zone.centerLatitude) * Math.PI) / 180) * 6_371_000
      const ax = x(a[0]),
        ay = y(a[1]),
        bx = x(b[0]),
        by = y(b[1])
      const dx = bx - ax,
        dy = by - ay,
        lengthSquared = dx * dx + dy * dy
      const t =
        lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared))
      return Math.hypot(ax + t * dx, ay + t * dy) <= zone.radiusMeters + 25
    })
  const segments: Coordinate[][] = []
  let segment: Coordinate[] = []
  function finish() {
    if (segment.length > 1) segments.push(segment)
    segment = []
  }
  for (const point of points) {
    if (hidden(point)) {
      finish()
      continue
    }
    const previous = segment.at(-1)
    if (previous && intersects(previous, point)) finish()
    segment.push(point)
  }
  finish()
  if (!segments.length)
    throw new Error('No shareable route remains outside your privacy zones. Nothing was uploaded.')
  return segments
}
export function decodeRouteSegments(polyline: string): Coordinate[][] {
  return polyline
    .split(';')
    .filter(Boolean)
    .map(decodePolyline)
    .filter((segment) => segment.length > 1)
}
export function uploadId(source: UploadSource): string {
  // Reconstructed ride ids include a changing end time. Use durable recording identity where available.
  const key = source.recordingId ?? `${source.boardId ?? 'unassigned'}:${source.startAtMs}`
  return `vescape-${encodeURIComponent(key)}`
}
export function makeSession(
  source: UploadSource,
  points: Coordinate[],
  zones: PrivacyZone[],
  timezone: string,
): FloatySession {
  if (
    !Number.isFinite(source.startAtMs) ||
    !Number.isFinite(source.endAtMs) ||
    source.endAtMs <= source.startAtMs
  )
    throw new Error('This ride has no completed time range.')
  const polyline = protectRoute(points, zones).map(encodePolyline).join(';')
  if (polyline.length > 400_000)
    throw new Error('This route exceeds Floaty’s session size limit. Your local recording is safe.')
  return {
    id: uploadId(source),
    distance: Math.max(0, source.distanceM ?? 0) / 1000,
    topSpeed: Math.max(0, source.maxSpeedKmh),
    startTime: source.startAtMs,
    endTime: source.endAtMs,
    timezone,
    polyline,
    publicPolyline: polyline,
    groupRideId: null,
  }
}

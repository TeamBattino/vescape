import { describe, expect, test } from 'bun:test'
import type { PrivacyZone } from 'vescape-core'
import {
  coordinatesFromGpx,
  decodePolyline,
  decodeRouteSegments,
  encodePolyline,
  makeSession,
  protectRoute,
  uploadId,
  type Coordinate,
} from './route'
import type { UploadSource } from './types'
const source: UploadSource = {
  recordingId: 'recording-1',
  boardId: 'board-1',
  boardName: 'Board',
  startAtMs: 1000,
  endAtMs: 61_000,
  distanceM: 1250,
  maxSpeedKmh: 24,
}
const zone: PrivacyZone = {
  id: 'home',
  name: 'Home',
  preset: 'custom',
  centerLatitude: 0,
  centerLongitude: 0,
  radiusMeters: 100,
  enabled: true,
  createdAt: 0,
  updatedAt: 0,
}
describe('Floaty route contract', () => {
  test('uses standard precision-5 latitude-first polyline encoding', () => {
    const points: Coordinate[] = [
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]
    expect(encodePolyline(points)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@')
    expect(decodePolyline(encodePolyline(points))).toEqual(points)
  })
  test('rejects truncated and invalid remote polylines', () => {
    expect(() => decodePolyline('_')).toThrow('malformed')
    expect(() => decodePolyline('!!')).toThrow('malformed')
  })
  test('multipart routes never reconnect a hidden gap', () => {
    const segments: Coordinate[][] = [
      [
        [1, 1],
        [1.1, 1.1],
      ],
      [
        [2, 2],
        [2.1, 2.1],
      ],
    ]
    expect(decodeRouteSegments(segments.map(encodePolyline).join(';'))).toEqual(segments)
  })
  test('native GPX reads every valid point and fails on invalid coordinates', () => {
    expect(
      coordinatesFromGpx(
        '<trkpt lat="47" lon="8"><time>x</time></trkpt><trkpt lat="48" lon="9"></trkpt>',
      ),
    ).toEqual([
      [8, 47],
      [9, 48],
    ])
    expect(() => coordinatesFromGpx('<trkpt lat="NaN" lon="8">')).toThrow('invalid')
    expect(() => coordinatesFromGpx('<gpx/>')).toThrow('two recorded')
  })
  test('trims private endpoints and splits interior zones', () => {
    const points: Coordinate[] = [
      [-0.003, 0],
      [-0.002, 0],
      [0, 0],
      [0.002, 0],
      [0.003, 0],
    ]
    expect(protectRoute(points, [zone])).toEqual([points.slice(0, 2), points.slice(3)])
    expect(
      protectRoute(
        [
          [0, 0],
          [0.002, 0],
          [0.003, 0],
        ],
        [zone],
      ),
    ).toEqual([
      [
        [0.002, 0],
        [0.003, 0],
      ],
    ])
  })
  test('detects segments crossing a zone even when neither endpoint is inside', () => {
    expect(
      protectRoute(
        [
          [-0.003, 0],
          [-0.002, 0],
          [0.002, 0],
          [0.003, 0],
        ],
        [zone],
      ),
    ).toHaveLength(2)
  })
  test('an entirely private route cannot be uploaded', () => {
    expect(() =>
      protectRoute(
        [
          [0, 0],
          [0.0001, 0],
        ],
        [zone],
      ),
    ).toThrow('No shareable route')
  })
  test('disabled zones do not change a route', () => {
    const points: Coordinate[] = [
      [-0.002, 0],
      [0, 0],
      [0.002, 0],
    ]
    expect(protectRoute(points, [{ ...zone, enabled: false }])).toEqual([points])
  })
  test('session summaries preserve Floaty units and use only masked geometry', () => {
    const session = makeSession(
      source,
      [
        [0, 0],
        [0.002, 0],
        [0.003, 0],
      ],
      [zone],
      'Europe/Lisbon',
    )
    expect(session.distance).toBe(1.25)
    expect(session.topSpeed).toBe(24)
    expect(session.timezone).toBe('Europe/Lisbon')
    expect(session.polyline).toBe(session.publicPolyline)
    expect(decodePolyline(session.polyline)).toEqual([
      [0.002, 0],
      [0.003, 0],
    ])
    expect(session).not.toHaveProperty('locations')
    expect(session).not.toHaveProperty('isImported')
  })
  test('identity stays stable when a ride end changes, but separates recordings and boards', () => {
    expect(uploadId(source)).toBe(uploadId({ ...source, endAtMs: 90_000 }))
    expect(uploadId(source)).not.toBe(uploadId({ ...source, recordingId: 'recording-2' }))
    expect(uploadId({ ...source, recordingId: null })).not.toBe(
      uploadId({ ...source, recordingId: null, boardId: 'board-2' }),
    )
  })
})

import { expect, test } from 'bun:test'
import type { LiveStateEvent } from 'vescape-core'
import { isRideStillRecording } from './uploadReadiness'
import type { UploadSource } from './types'
const source: UploadSource = {
  recordingId: 'ride-a',
  boardId: 'board',
  boardName: 'Board',
  startAtMs: 1000,
  endAtMs: 2000,
  distanceM: 100,
  maxSpeedKmh: 10,
}
const recording: LiveStateEvent['recording'] = {
  enabled: true,
  paused: false,
  recordingId: 'ride-a',
  activeBoardId: 'board',
  startedAt: 900,
}

test('a paused or disconnected recording is not a completed upload even with old last samples', () => {
  expect(isRideStillRecording(source, { ...recording, paused: true })).toBe(true)
  expect(isRideStillRecording(source, { ...recording, startedAt: null })).toBe(true)
})
test('ending the recording allows immediate upload without a three-minute timer', () => {
  expect(isRideStillRecording(source, { ...recording, enabled: false })).toBe(false)
})
test('an older completed ride can upload while another ride on that board records', () => {
  expect(isRideStillRecording(source, { ...recording, recordingId: 'ride-b' })).toBe(false)
  expect(
    isRideStillRecording({ ...source, recordingId: null }, { ...recording, startedAt: 3000 }),
  ).toBe(false)
})
test('legacy native snapshots fail closed only for the recording board', () => {
  expect(isRideStillRecording(source, { ...recording, recordingId: null, startedAt: null })).toBe(
    true,
  )
  expect(
    isRideStillRecording(source, { ...recording, recordingId: null, activeBoardId: 'other' }),
  ).toBe(false)
})

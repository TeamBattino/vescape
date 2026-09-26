import { describe, expect, test } from 'bun:test'
import type { HistoryGpsSample, HistoryMarker, HistoryRange, LiveStateEvent } from 'vescape-core'
import { createRecordedLiveTrail, recordedTrailShape } from './recordedLiveTrail'

const recording = (id = 'ride'): LiveStateEvent['recording'] => ({
  enabled: true,
  paused: false,
  activeBoardId: 'board',
  recordingId: id,
  startedAt: 0,
})
const point = (time: number, ride = 'ride'): HistoryGpsSample => ({
  id: time,
  recordingId: ride,
  capturedAtMs: time,
  timestamp: time,
  boardId: 'board',
  boardName: 'Board',
  latitude: 40,
  longitude: time / 1e7,
  speedMps: 5,
  bearingDeg: null,
  accuracyM: 3,
  altitudeM: null,
  distanceFromPreviousM: null,
})
const range = (gpsSamples: HistoryGpsSample[]): HistoryRange => ({
  gpsSamples,
  boardSamples: [],
  chartSamples: [],
  markers: [],
  exclusions: [],
})

describe('durable live route recovery', () => {
  test('rehydrates a long ride in bounded windows and retains its beginning through incremental reads', async () => {
    const all = Array.from({ length: 1_801 }, (_, i) => point(i * 1_000))
    const calls: {
      fromMs: number
      toMs: number
      recordingId: string
      boardId: string
      limit: number
    }[] = []
    const frames: ReturnType<typeof recordedTrailShape>[] = []
    const recovery = createRecordedLiveTrail(
      async (options) => {
        calls.push(options)
        return range(
          all.filter((p) => p.capturedAtMs >= options.fromMs && p.capturedAtMs <= options.toMs),
        )
      },
      ({ shape }) => frames.push(shape),
    )
    recovery.setRecording(recording())
    await recovery.refresh(1_800_000)
    expect(calls).toHaveLength(7)
    expect(
      calls.every(
        (call) =>
          call.recordingId === 'ride' &&
          call.boardId === 'board' &&
          call.limit === 1 &&
          call.toMs - call.fromMs < 300_000,
      ),
    ).toBe(true)
    expect(frames.at(-1)?.geometry.coordinates[0]).toHaveLength(1_801)
    all.push(point(1_801_000))
    await recovery.refresh(1_805_000)
    expect(calls.at(-1)?.fromMs).toBe(1_740_000)
    expect(frames.at(-1)?.geometry.coordinates[0]).toHaveLength(1_802)
    expect(frames.at(-1)?.geometry.coordinates[0][0]).toEqual([0, 40])
  })

  test('keeps fresh fixes timestamped before recording start without including a different ride or Board', async () => {
    const frames: ReturnType<typeof recordedTrailShape>[] = []
    let queriedFrom: number | undefined
    const recovery = createRecordedLiveTrail(
      async (options) => {
        queriedFrom = options.fromMs
        return range([
          point(88_800),
          point(89_200),
          point(90_100),
          point(89_000, 'previous'),
          { ...point(89_100), boardId: 'other-board' },
        ])
      },
      ({ shape }) => frames.push(shape),
    )
    recovery.setRecording({ ...recording(), startedAt: 90_000 })
    await recovery.refresh(91_000)
    expect(queriedFrom).toBe(30_000)
    expect(frames.at(-1)?.geometry.coordinates[0]).toEqual([
      [88_800 / 1e7, 40],
      [89_200 / 1e7, 40],
      [90_100 / 1e7, 40],
    ])
  })

  test('drops old async results across a recording switch, including the same Board', async () => {
    let finishOld!: (value: HistoryRange) => void
    const frames: ReturnType<typeof recordedTrailShape>[] = []
    const recovery = createRecordedLiveTrail(
      (options) =>
        options.recordingId === 'ride'
          ? new Promise((resolve) => {
              finishOld = resolve
            })
          : Promise.resolve(range([point(10, 'next'), point(20, 'next')])),
      ({ shape }) => frames.push(shape),
    )
    recovery.setRecording(recording())
    const old = recovery.refresh(100)
    recovery.setRecording(recording('next'))
    await recovery.refresh(100)
    const frameCount = frames.length
    finishOld(range([point(30), point(40)]))
    await old
    expect(frames).toHaveLength(frameCount)
    expect(frames.at(-1)?.geometry.coordinates[0][0][0]).toBe(10 / 1e7)
  })

  test('stopping or unmounting invalidates pending reads', async () => {
    for (const action of ['stop', 'dispose']) {
      let finish!: (value: HistoryRange) => void
      const frames: unknown[] = []
      const recovery = createRecordedLiveTrail(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
        (snapshot) => frames.push(snapshot),
      )
      recovery.setRecording(recording())
      const pending = recovery.refresh(100)
      if (action === 'stop') recovery.setRecording({ ...recording(), enabled: false })
      else recovery.dispose()
      const frameCount = frames.length
      finish(range([point(1), point(2)]))
      await pending
      expect(frames).toHaveLength(frameCount)
    }
  })

  test('does not guess an active recording from a different ride or a recent GPS buffer', async () => {
    const frames: ReturnType<typeof recordedTrailShape>[] = []
    let calls = 0
    const recovery = createRecordedLiveTrail(
      async () => {
        calls++
        return range([point(1, 'other'), point(2, 'other')])
      },
      ({ shape }) => frames.push(shape),
    )
    recovery.setRecording({ ...recording(), recordingId: null })
    await recovery.refresh(100)
    expect(calls).toBe(0)
    recovery.setRecording(recording())
    await recovery.refresh(100)
    expect(frames.at(-1)).toBeNull()
  })

  test('retries a failed read without losing already recovered points', async () => {
    let fail = false
    const frames: unknown[] = []
    const recovery = createRecordedLiveTrail(
      async () => {
        if (fail) throw new Error('database busy')
        return range([point(1), point(2)])
      },
      (snapshot) => frames.push(snapshot),
    )
    recovery.setRecording(recording())
    await recovery.refresh(100)
    const count = frames.length
    fail = true
    await expect(recovery.refresh(200)).rejects.toThrow('database busy')
    expect(frames).toHaveLength(count)
    fail = false
    await recovery.refresh(300)
    expect(frames).toHaveLength(count + 1)
  })

  test('does not draw connecting lines through recording pauses or long missing-GPS intervals', () => {
    const marker: HistoryMarker = {
      id: 1,
      occurredAtMs: 15,
      type: 'auto_pause',
      boardId: 'board',
      message: null,
      gapMs: null,
    }
    const shape = recordedTrailShape(
      [point(1), point(2), point(20), point(21), point(40_000), point(40_001)],
      [marker],
    )
    expect(shape?.geometry.coordinates.map((line) => line.length)).toEqual([2, 2, 2])
  })
})

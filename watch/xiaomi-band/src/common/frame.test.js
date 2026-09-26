import { describe, expect, test } from 'bun:test'
import { decodeFrame } from './frame'
const frame = (values) => JSON.stringify({ type: 'vescape.frame', version: 1, ...values })
describe('phone to band telemetry contract', () => {
  test('km/h and percentage arrive without a second conversion', () => {
    expect(decodeFrame(frame({ speed: 30, duty: 74 }))).toEqual({
      state: 'LIVE',
      battery: '--',
      speed: '30',
      duty: '74',
      speedScale: 25,
      dutyScale: 37,
    })
  })
  test('stale or waiting frames clear both gauges even with numeric payloads', () => {
    for (const flag of ['stale', 'waiting']) {
      const decoded = decodeFrame(frame({ speed: 32, duty: 60, [flag]: true }))
      expect(decoded.speed).toBe('--')
      expect(decoded.duty).toBe('--')
      expect(decoded.speedScale + decoded.dutyScale).toBe(0)
    }
  })
  test('missing duty is not falsely displayed as zero', () => {
    expect(decodeFrame(frame({ speed: 0, duty: null }))).toMatchObject({
      speed: '0',
      duty: '--',
      dutyScale: 0,
    })
  })
  test('scales saturate while readings preserve out of range values', () => {
    expect(decodeFrame(frame({ speed: -80, duty: 105 }))).toMatchObject({
      speed: '80',
      duty: '105',
      speedScale: 50,
      dutyScale: 50,
    })
  })
  test('malformed and other protocol messages cannot refresh the display', () => {
    expect(decodeFrame('{')).toBeNull()
    expect(decodeFrame('{"type":"vescape.hello","version":1}')).toBeNull()
    expect(decodeFrame({ type: 'vescape.frame', version: 2, speed: 99 })).toBeNull()
    expect(
      decodeFrame({ type: 'vescape.frame', version: 1, speed: Infinity, duty: '88' }),
    ).toMatchObject({ speed: '--', duty: '--' })
  })
})

test('board battery is optional and clears with stale telemetry', () => {
  expect(decodeFrame(frame({ speed: 20, duty: 35, battery: 82.4 }))).toMatchObject({
    battery: '82%',
  })
  expect(decodeFrame(frame({ speed: 20, duty: 35, battery: 82.4, stale: true }))).toMatchObject({
    battery: '--',
  })
})

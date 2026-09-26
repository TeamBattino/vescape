import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createScaleMotion } from './scaleMotion'
import { capsuleSegments } from './capsuleSegments'
import { decodeFrame, EXPIRES_MS } from './frame'
const frame = (speed, duty = speed) => ({
  state: 'LIVE',
  speed: String(speed),
  duty: String(duty),
  speedScale: speed,
  dutyScale: duty,
})
test('first known reading snaps, subsequent motion finishes without overshoot', () => {
  const motion = createScaleMotion()
  motion.target(frame(10), 0)
  expect(motion.sample(0)).toMatchObject({ speed: 10, duty: 10, done: true })
  motion.target(frame(50), 100)
  expect(motion.sample(190).speed).toBe(30)
  expect(motion.sample(500)).toMatchObject({ speed: 50, duty: 50, done: true })
})
test('new target replaces in-flight motion and missing data clears immediately', () => {
  const motion = createScaleMotion()
  motion.target(frame(0), 0)
  motion.target(frame(40), 100)
  motion.target(frame(0), 190)
  expect(motion.sample(190).speed).toBe(20)
  expect(motion.sample(280).speed).toBe(10)
  motion.target({ ...frame(50), speed: '--' }, 280)
  expect(motion.sample(280).speed).toBe(0)
  motion.target({ ...frame(50), state: 'SIGNAL LOST' }, 290)
  expect(motion.sample(290)).toMatchObject({ speed: 0, duty: 0, done: true })
  motion.reset()
  motion.target(frame(30), 300)
  expect(motion.sample(300).speed).toBe(30)
})
test('hidden page cancels animation, clears readings and ignores incoming telemetry', () => {
  const source = readFileSync(new URL('../pages/home/home.ux', import.meta.url), 'utf8')
    .split('<script>')[1]
    .split('</script>')[0]
    .replace(/^import .*$/gm, '')
    .replace('export default', 'return')
  const timers = new Set()
  const wake = []
  const page = Function(
    'interconnect',
    'brightness',
    'createScaleMotion',
    'capsuleSegments',
    'decodeFrame',
    'EXPIRES_MS',
    'setInterval',
    'clearInterval',
    source,
  )(
    { instance: () => ({ send() {} }) },
    { setKeepScreenOn: ({ keepScreenOn }) => wake.push(keepScreenOn) },
    createScaleMotion,
    capsuleSegments,
    decodeFrame,
    EXPIRES_MS,
    (callback) => {
      timers.add(callback)
      return callback
    },
    (callback) => timers.delete(callback),
  )
  Object.assign(page, page.private)
  page.onInit()
  page.onShow()
  page.receive({ type: 'vescape.frame', version: 1, speed: 10, duty: 10 })
  page.receive({ type: 'vescape.frame', version: 1, speed: 40, duty: 90 })
  expect(wake.at(-1)).toBe(true)
  expect(timers.size).toBe(2)
  page.onHide()
  expect(timers.size).toBe(0)
  expect(page.speed).toBe('--')
  expect(wake.at(-1)).toBe(false)
  page.receive({ type: 'vescape.frame', version: 1, speed: 50, duty: 99 })
  expect(page.speed).toBe('--')
  expect(timers.size).toBe(0)
  expect(wake.at(-1)).toBe(false)
  page.onDestroy()
})

test('digits ease to latest target in 90ms without overshoot, unavailable clears immediately', () => {
  const motion = createScaleMotion()
  motion.target(frame(10), 0)
  motion.target(frame(40), 100)
  expect(motion.sample(145).speedText).toBe('25')
  motion.target(frame(0), 145)
  expect(motion.sample(190).speedText).toBe('13')
  expect(motion.sample(235).speedText).toBe('0')
  motion.target({ ...frame(50), speed: '--' }, 240)
  expect(motion.sample(240).speedText).toBe('--')
  motion.target(frame(30), 250)
  expect(motion.sample(250).speedText).toBe('30')
})

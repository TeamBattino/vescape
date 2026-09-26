import { expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { capsuleSegments } from './capsuleSegments'

test('capsule fills bottom arc, vertical edge, then top arc continuously', () => {
  expect(capsuleSegments(0)).toEqual({ Bottom: 0, Top: 0, FillTop: 414, FillHeight: 0 })
  expect(capsuleSegments(25)).toEqual({ Bottom: 100, Top: 0, FillTop: 260, FillHeight: 154 })
  expect(capsuleSegments(50)).toEqual({ Bottom: 100, Top: 100, FillTop: 106, FillHeight: 308 })
  let previous = capsuleSegments(0)
  for (let step = 1; step <= 50; step++) {
    const next = capsuleSegments(step)
    expect(
      next.Bottom >= previous.Bottom &&
        next.Top >= previous.Top &&
        next.FillHeight >= previous.FillHeight,
    ).toBe(true)
    expect(next.FillTop + next.FillHeight).toBe(414)
    previous = next
  }
  expect(capsuleSegments(100)).toEqual(capsuleSegments(50))
})

test('watch assets cannot regress to oversized icon or bitmap scale animation', () => {
  const icon = readFileSync(new URL('./icon.png', import.meta.url))
  expect(icon.readUInt32BE(16)).toBe(96)
  expect(icon.readUInt32BE(20)).toBe(96)
  expect(readdirSync(new URL('.', import.meta.url))).not.toContain('scales')
  const page = readFileSync(new URL('../pages/home/home.ux', import.meta.url), 'utf8')
  expect(page).not.toContain('<image')
})

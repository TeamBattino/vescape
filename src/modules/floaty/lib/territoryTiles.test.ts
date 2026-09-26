import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  decodeTerritoryTile,
  mergeTerritoryTiles,
  TerritoryTileCache,
  territoryTilePlan,
  TERRITORY_TILE_LIMIT,
  type TerritoryViewport,
} from './territoryTiles'

const viewport: TerritoryViewport = {
  west: -7.95,
  east: -7.91,
  south: 37,
  north: 37.04,
  longitude: -7.93,
  latitude: 37.02,
}
const fixture = readFileSync(new URL('./__fixtures__/territory-14-7831-6376.pbf', import.meta.url))
const bytes = fixture.buffer.slice(
  fixture.byteOffset,
  fixture.byteOffset + fixture.byteLength,
) as ArrayBuffer
const tile = { x: 7831, y: 6376, key: '7831/6376' }

describe('detailed territory across zooms', () => {
  test('decodes the actual published Faro tile without using overview ownership', () => {
    const features = decodeTerritoryTile(bytes, tile)
    const cells = features.filter((feature) => feature.properties.isCell)
    expect(cells).toHaveLength(6)
    expect(cells.every((cell) => cell.properties.color === '#E4F2D0')).toBe(true)
    expect(features.some((feature) => feature.properties.clubName === 'VXwheel')).toBe(true)
  })

  test('world and regional viewports stay bounded; antimeridian selects both edges', () => {
    const world = territoryTilePlan({
      west: -180,
      east: 180,
      south: -85,
      north: 85,
      longitude: 0,
      latitude: 0,
    })
    expect(world.limited).toBe(true)
    expect(world.tiles.length).toBeLessThanOrEqual(TERRITORY_TILE_LIMIT)
    expect(new Set(world.tiles.map((item) => item.key)).size).toBe(world.tiles.length)
    const dateLine = territoryTilePlan({
      west: 179.99,
      east: -179.99,
      south: -0.01,
      north: 0.01,
      longitude: 180,
      latitude: 0,
    })
    expect(dateLine.limited).toBe(false)
    expect(dateLine.tiles.some((item) => item.x === 0)).toBe(true)
    expect(dateLine.tiles.some((item) => item.x === 16383)).toBe(true)
    expect(territoryTilePlan(viewport).limited).toBe(false)
    expect(territoryTilePlan({ ...viewport, north: NaN }).tiles).toEqual([])
  })

  test('unions overlapping buffered fragments once and deduplicates club labels', () => {
    const cell = (
      left: number,
      right: number,
      color = '#C4031A',
    ): GeoJSON.Feature<GeoJSON.Polygon, Record<string, unknown>> => ({
      type: 'Feature',
      id: 42,
      properties: { color, isCell: true },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [left, 0],
            [right, 0],
            [right, 1],
            [left, 1],
            [left, 0],
          ],
        ],
      },
    })
    const label: GeoJSON.Feature<GeoJSON.Point, Record<string, unknown>> = {
      type: 'Feature',
      id: 84,
      properties: { isLabel: true, clubName: 'Club', clubId: 'club', color: '#C4031A' },
      geometry: { type: 'Point', coordinates: [1, 0.5] },
    }
    const shape = mergeTerritoryTiles(
      [
        { features: [cell(0, 1.1), label], modified: 2, bytes: 1 },
        { features: [cell(0.9, 2), label], modified: 2, bytes: 1 },
        { features: [cell(0, 2, '#000000')], modified: 1, bytes: 1 },
      ],
      viewport,
    )
    const cells = shape.features.filter((f) => f.properties?.isCell)
    expect(cells).toHaveLength(1)
    expect(cells[0].properties?.color).toBe('#C4031A')
    expect((cells[0].geometry as GeoJSON.MultiPolygon).coordinates).toEqual([
      [
        [
          [0, 0],
          [2, 0],
          [2, 1],
          [0, 1],
          [0, 0],
        ],
      ],
    ])
    expect(shape.features.filter((f) => f.properties?.isLabel)).toHaveLength(1)
    expect(shape.features.filter((f) => f.properties?.isOverviewLabel)).toHaveLength(1)
  })

  test('reuses detailed tiles across zooms and invalidates all data on refresh', async () => {
    const urls: string[] = []
    const cache = new TerritoryTileCache(async (url: string) => {
      urls.push(url)
      return new Response(bytes, { headers: { 'last-modified': 'Thu, 24 Sep 2026 21:25:55 GMT' } })
    })
    const plan = { tiles: [tile], limited: false }
    await cache.load(plan, 10, new AbortController().signal)
    await cache.load(plan, 10, new AbortController().signal)
    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain('/14/7831/6376.pbf?v=10')
    expect(cache.shape(viewport).features.length).toBeGreaterThan(6)
    await cache.load(plan, 11, new AbortController().signal)
    expect(urls).toHaveLength(2)
    expect(urls[1]).toEndWith('?v=11')
  })

  test('bounds concurrency, retries failures, and ignores cancelled responses', async () => {
    let active = 0
    let peak = 0
    let calls = 0
    const cache = new TerritoryTileCache(async () => {
      active++
      calls++
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active--
      return new Response(null, { status: 503 })
    })
    const plan = {
      tiles: Array.from({ length: 12 }, (_, i) => ({ x: i, y: 1, key: `${i}/1` })),
      limited: false,
    }
    expect(await cache.load(plan, 1, new AbortController().signal)).toBe(12)
    expect(peak).toBeLessThanOrEqual(4)
    await cache.load(plan, 1, new AbortController().signal)
    expect(calls).toBe(24)
    const controller = new AbortController()
    const cancelled = new TerritoryTileCache(async () => {
      controller.abort()
      return new Response(bytes)
    })
    await cancelled.load({ tiles: [tile], limited: false }, 1, controller.signal)
    expect(cancelled.shape(viewport).features).toEqual([])
  })
})

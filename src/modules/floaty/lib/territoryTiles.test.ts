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

  test('bounds concurrency across simultaneous loads and backs off failed tiles', async () => {
    let active = 0
    let peak = 0
    let calls = 0
    const cache = new TerritoryTileCache(
      async () => {
        active++
        calls++
        peak = Math.max(peak, active)
        await Bun.sleep(2)
        active--
        return new Response(null, { status: 503 })
      },
      { retryDelayMs: 15 },
    )
    const plan = {
      tiles: Array.from({ length: 12 }, (_, i) => ({ x: i, y: 1, key: `${i}/1` })),
      limited: false,
    }
    const results = await Promise.all([
      cache.load(plan, 1, new AbortController().signal),
      cache.load(plan, 1, new AbortController().signal),
    ])
    expect(results).toEqual([12, 12])
    expect(peak).toBeLessThanOrEqual(8)
    expect(calls).toBe(12)
    await cache.load(plan, 1, new AbortController().signal)
    expect(calls).toBe(12)
    await Bun.sleep(20)
    await cache.load(plan, 1, new AbortController().signal)
    expect(calls).toBe(24)
  })

  test('cancelling a viewport returns promptly and reuses its in-flight request', async () => {
    let finish!: (response: Response) => void
    let calls = 0
    const cache = new TerritoryTileCache(() => {
      calls++
      return new Promise<Response>((resolve) => {
        finish = resolve
      })
    })
    const plan = { tiles: [tile], limited: false }
    const controller = new AbortController()
    let cancelledProgress = 0
    const first = cache.load(plan, 1, controller.signal, () => {
      cancelledProgress++
    })
    await Bun.sleep(1)
    controller.abort()
    expect(await first).toBe(1)
    const second = cache.load(plan, 1, new AbortController().signal)
    finish(new Response(bytes))
    expect(await second).toBe(0)
    expect(calls).toBe(1)
    expect(cancelledProgress).toBe(0)
    expect(cache.coverage(plan, 1)).toEqual({ loaded: 1, total: 1 })
  })

  test('whole-pass deadline finishes even when transport ignores abort', async () => {
    const cache = new TerritoryTileCache(() => new Promise<Response>(() => {}), {
      loadTimeoutMs: 15,
      requestTimeoutMs: 30,
    })
    const plan = {
      tiles: Array.from({ length: 128 }, (_, i) => ({ x: i, y: 1, key: `${i}/1` })),
      limited: false,
    }
    const start = Date.now()
    expect(await cache.load(plan, 1, new AbortController().signal)).toBe(128)
    expect(Date.now() - start).toBeLessThan(250)
    await Bun.sleep(35)
    expect(cache.coverage(plan).loaded).toBe(0)
  })

  test('request timeout covers a stalled response body and rejects its late data', async () => {
    let finish!: (data: ArrayBuffer) => void
    const cache = new TerritoryTileCache(
      () =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          arrayBuffer: () =>
            new Promise<ArrayBuffer>((resolve) => {
              finish = resolve
            }),
        } as Response),
      { requestTimeoutMs: 10, loadTimeoutMs: 50 },
    )
    const plan = { tiles: [tile], limited: false }
    expect(await cache.load(plan, 1, new AbortController().signal)).toBe(1)
    finish(bytes)
    await Bun.sleep(1)
    expect(cache.coverage(plan).loaded).toBe(0)
    expect(cache.shape(viewport).features).toEqual([])
  })

  test('publishes small batches on elapsed time without waiting for sixteen tiles', async () => {
    const resolvers: ((response: Response) => void)[] = []
    const cache = new TerritoryTileCache(
      () =>
        new Promise<Response>((resolve) => {
          resolvers.push(resolve)
        }),
      { progressIntervalMs: 5 },
    )
    const plan = {
      tiles: Array.from({ length: 3 }, (_, i) => ({ x: i, y: 1, key: `${i}/1` })),
      limited: false,
    }
    const progress: number[] = []
    const load = cache.load(plan, 1, new AbortController().signal, (state) =>
      progress.push(state.loaded),
    )
    await Bun.sleep(1)
    resolvers[0](new Response(null, { status: 404 }))
    await Bun.sleep(8)
    resolvers[1](new Response(null, { status: 404 }))
    await Bun.sleep(8)
    expect(progress).toEqual([1, 2])
    resolvers[2](new Response(null, { status: 404 }))
    expect(await load).toBe(0)
    expect(progress.at(-1)).toBe(3)
  })

  test('refresh rejects late responses and never presents previous-generation ownership', async () => {
    let finish!: (response: Response) => void
    let calls = 0
    const cache = new TerritoryTileCache(() => {
      calls++
      return calls === 1
        ? new Promise<Response>((resolve) => {
            finish = resolve
          })
        : Promise.resolve(new Response(null, { status: 404 }))
    })
    const plan = { tiles: [tile], limited: false }
    const first = cache.load(plan, 1, new AbortController().signal)
    await Bun.sleep(1)
    expect(await cache.load(plan, 2, new AbortController().signal)).toBe(0)
    finish(new Response(bytes))
    await first
    await Bun.sleep(1)
    expect(cache.shape(viewport, 1).features).toEqual([])
    expect(cache.shape(viewport, 2).features).toEqual([])
    expect(cache.coverage(plan, 2).loaded).toBe(1)
  })

  test('reports time-based progress and preserves completed regions including empty tiles', async () => {
    let calls = 0
    const cache = new TerritoryTileCache(
      async () => {
        calls++
        await Bun.sleep(calls === 1 ? 2 : 8)
        return calls === 1 ? new Response(bytes) : new Response(null, { status: 404 })
      },
      { progressIntervalMs: 3 },
    )
    const plan = { tiles: [tile], limited: false }
    const progress: number[] = []
    await cache.load(plan, 1, new AbortController().signal, (state) => progress.push(state.loaded))
    const next = { tiles: [{ x: 1, y: 1, key: '1/1' }], limited: false }
    await cache.load(next, 1, new AbortController().signal)
    expect(progress).toContain(1)
    expect(cache.shape(viewport).features.length).toBeGreaterThan(6)
    expect(cache.coverage({ tiles: [...plan.tiles, ...next.tiles], limited: false })).toEqual({
      loaded: 2,
      total: 2,
    })
    await cache.load(next, 1, new AbortController().signal)
    expect(calls).toBe(2)
  })
})

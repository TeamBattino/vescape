import { VectorTile } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'
import polygonClipping, { type MultiPolygon } from 'polygon-clipping'

export const TERRITORY_DETAIL_ZOOM = 14
export const TERRITORY_TILE_LIMIT = 128
const GRID = 2 ** TERRITORY_DETAIL_ZOOM
const CACHE_LIMIT = 384
const MAX_TILE_BYTES = 512 * 1024
const MAX_TILE_FEATURES = 4096
const MAX_CACHE_BYTES = 16 * 1024 * 1024
export const TERRITORY_TILES = 'https://cdn.floaty-app.com/territory-tiles/{z}/{x}/{y}.pbf'
export interface TerritoryViewport {
  west: number
  south: number
  east: number
  north: number
  longitude: number
  latitude: number
}
export interface TerritoryTile {
  x: number
  y: number
  key: string
}
export interface TerritoryPlan {
  tiles: TerritoryTile[]
  limited: boolean
}
type TerritoryFeature = GeoJSON.Feature<
  GeoJSON.Polygon | GeoJSON.MultiPolygon | GeoJSON.Point,
  Record<string, unknown>
>
interface TileData {
  features: TerritoryFeature[]
  bytes: number
  modified: number
}
export const EMPTY_TERRITORY: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
}

function tileY(latitude: number) {
  const radians = (Math.max(-85.05112878, Math.min(85.05112878, latitude)) * Math.PI) / 180
  return Math.max(0, Math.min(GRID - 1, ((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * GRID))
}
function wrap(x: number) {
  return ((x % GRID) + GRID) % GRID
}

/** Never enumerate the full world: select a bounded rectangle nearest the viewport centre. */
export function territoryTilePlan(viewport: TerritoryViewport): TerritoryPlan {
  if (!Object.values(viewport).every(Number.isFinite)) return { tiles: [], limited: false }
  const west = viewport.west
  let east = viewport.east
  if (east < west) east += Math.ceil((west - east) / 360) * 360
  const width = Math.min(360, east - west)
  const left = Math.floor(((west + 180) / 360) * GRID)
  const right = Math.min(left + GRID - 1, Math.floor(((west + width + 180) / 360) * GRID))
  const top = Math.floor(tileY(viewport.north))
  const bottom = Math.max(top, Math.floor(tileY(viewport.south)))
  const columns = right - left + 1
  const rows = bottom - top + 1
  const limited = columns * rows > TERRITORY_TILE_LIMIT
  let countX = columns
  let countY = rows
  if (limited) {
    countX = Math.min(
      columns,
      TERRITORY_TILE_LIMIT,
      Math.max(1, Math.round(Math.sqrt((TERRITORY_TILE_LIMIT * columns) / rows))),
    )
    countY = Math.min(rows, Math.max(1, Math.floor(TERRITORY_TILE_LIMIT / countX)))
    countX = Math.min(columns, Math.floor(TERRITORY_TILE_LIMIT / countY))
  }
  let centerX = ((viewport.longitude + 180) / 360) * GRID
  centerX += Math.round(((left + right) / 2 - centerX) / GRID) * GRID
  const centerY = tileY(viewport.latitude)
  const startX = Math.max(left, Math.min(right - countX + 1, Math.floor(centerX - countX / 2)))
  const startY = Math.max(top, Math.min(bottom - countY + 1, Math.floor(centerY - countY / 2)))
  const tiles: TerritoryTile[] = []
  for (let y = startY; y < startY + countY; y++) {
    for (let x = startX; x < startX + countX; x++)
      tiles.push({ x: wrap(x), y, key: `${wrap(x)}/${y}` })
  }
  tiles.sort((a, b) => {
    const distance = (tile: TerritoryTile) =>
      Math.min(Math.abs(tile.x - wrap(centerX)), GRID - Math.abs(tile.x - wrap(centerX))) ** 2 +
      (tile.y - centerY) ** 2
    return distance(a) - distance(b)
  })
  return { tiles, limited }
}

export function decodeTerritoryTile(buffer: ArrayBuffer, tile: TerritoryTile): TerritoryFeature[] {
  if (buffer.byteLength > MAX_TILE_BYTES) throw new Error('Territory tile exceeds size limit')
  const layer = new VectorTile(new PbfReader(buffer)).layers.territory
  if (!layer) return []
  if (layer.length > MAX_TILE_FEATURES) throw new Error('Territory tile exceeds feature limit')
  const features: TerritoryFeature[] = []
  for (let index = 0; index < layer.length; index++) {
    const source = layer.feature(index)
    if (source.properties.isCell !== true && source.properties.isLabel !== true) continue
    const feature = source.toGeoJSON(tile.x, tile.y, TERRITORY_DETAIL_ZOOM)
    if (
      feature.geometry.type !== 'Polygon' &&
      feature.geometry.type !== 'MultiPolygon' &&
      feature.geometry.type !== 'Point'
    )
      continue
    const color = feature.properties?.color
    // A malformed server color must not become Mapbox's default black.
    if (typeof color !== 'string' || !/^#[\da-f]{6}$/i.test(color)) continue
    features.push(feature as TerritoryFeature)
  }
  return features
}

function polygonCoordinates(feature: TerritoryFeature): MultiPolygon {
  if (feature.geometry.type === 'Point') return []
  return (
    feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates
  ) as MultiPolygon
}

/** MVT buffers repeat and clip cells at tile edges. Union matching fragments before
 * drawing so translucent ownership never darkens at seams or gains false borders. */
export function mergeTerritoryTiles(
  tiles: TileData[],
  viewport: TerritoryViewport,
): GeoJSON.FeatureCollection {
  const cells = new Map<
    string,
    { feature: TerritoryFeature; polygons: MultiPolygon[]; modified: number }
  >()
  const labels = new Map<string, { feature: TerritoryFeature; modified: number }>()
  for (const tile of tiles) {
    for (const feature of tile.features) {
      if (feature.geometry.type === 'Point') {
        if (
          feature.properties.isLabel === true &&
          typeof feature.properties.clubName === 'string'
        ) {
          const key = String(
            feature.id ??
              `${String(feature.properties.clubId ?? feature.properties.clubName)}:${feature.geometry.coordinates.join(',')}`,
          )
          const previous = labels.get(key)
          if (!previous || tile.modified >= previous.modified)
            labels.set(key, { feature, modified: tile.modified })
        }
        continue
      }
      const key = String(feature.id ?? JSON.stringify(feature.geometry.coordinates))
      const previous = cells.get(key)
      if (
        !previous ||
        (previous.feature.properties.color !== feature.properties.color &&
          tile.modified > previous.modified)
      ) {
        cells.set(key, {
          feature,
          polygons: [polygonCoordinates(feature)],
          modified: tile.modified,
        })
      } else if (previous.feature.properties.color === feature.properties.color) {
        previous.polygons.push(polygonCoordinates(feature))
      }
    }
  }
  const features: GeoJSON.Feature[] = []
  for (const [id, cell] of cells) {
    const coordinates =
      cell.polygons.length === 1
        ? cell.polygons[0]
        : polygonClipping.union(cell.polygons[0], ...cell.polygons.slice(1))
    features.push({
      ...cell.feature,
      id: `cell-${id}`,
      geometry: { type: 'MultiPolygon', coordinates },
    })
  }
  const overviewLabels = new Map<string, TerritoryFeature>()
  const distance = (feature: TerritoryFeature) => {
    const [x, y] = (feature.geometry as GeoJSON.Point).coordinates
    const dx = Math.abs(x - viewport.longitude) % 360
    return Math.min(dx, 360 - dx) ** 2 + (y - viewport.latitude) ** 2
  }
  for (const [key, { feature: label }] of labels) {
    features.push({ ...label, id: `label-${key}` })
    const club = String(label.properties.clubId ?? label.properties.clubName)
    const previous = overviewLabels.get(club)
    if (!previous || distance(label) < distance(previous)) overviewLabels.set(club, label)
  }
  for (const [club, label] of overviewLabels)
    features.push({
      ...label,
      id: `club-${club}`,
      properties: { ...label.properties, isLabel: false, isOverviewLabel: true },
    })
  return { type: 'FeatureCollection', features }
}

export interface TerritoryLoadProgress {
  loaded: number
  total: number
}
interface CacheTiming {
  requestTimeoutMs: number
  loadTimeoutMs: number
  retryDelayMs: number
  progressIntervalMs: number
}
const CACHE_TIMING: CacheTiming = {
  requestTimeoutMs: 8000,
  loadTimeoutMs: 12000,
  retryDelayMs: 15000,
  progressIntervalMs: 350,
}
const REQUEST_CONCURRENCY = 8
interface PendingTile {
  controller: AbortController
  promise: Promise<void>
}

/** Stop waiting without depending on a transport honouring AbortSignal. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | undefined> {
  if (signal.aborted) return Promise.resolve(undefined)
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort)
      resolve(undefined)
    }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      },
    )
  })
}

/** Memory-only public map cache. Recording, account data and uploads never pass here.
 * A viewport owns its wait, not the request: brief pans can reuse an in-flight tile. */
export class TerritoryTileCache {
  private entries = new Map<string, TileData>()
  private pending = new Map<string, PendingTile>()
  private failures = new Map<string, number>()
  private waiters = new Set<() => void>()
  private revision: number | null = null
  private bytes = 0
  private active = 0
  private timing: CacheTiming
  constructor(
    private request: (url: string, options?: RequestInit) => Promise<Response> = fetch,
    timing: Partial<CacheTiming> = {},
  ) {
    this.timing = { ...CACHE_TIMING, ...timing }
  }

  private setRevision(revision: number) {
    if (revision === this.revision) return
    this.revision = revision
    for (const pending of this.pending.values()) pending.controller.abort()
    this.pending.clear()
    this.entries.clear()
    this.failures.clear()
    this.bytes = 0
  }

  private store(key: string, entry: TileData) {
    const previous = this.entries.get(key)
    if (previous) this.bytes -= previous.bytes
    this.entries.delete(key)
    this.entries.set(key, entry)
    this.bytes += entry.bytes
    while (this.entries.size > CACHE_LIMIT || this.bytes > MAX_CACHE_BYTES) {
      const oldest = this.entries.keys().next().value
      if (oldest == null) break
      this.bytes -= this.entries.get(oldest)!.bytes
      this.entries.delete(oldest)
    }
  }

  private async fetchTile(tile: TerritoryTile, revision: number, signal: AbortSignal) {
    const url = TERRITORY_TILES.replace('{z}', String(TERRITORY_DETAIL_ZOOM))
      .replace('{x}', String(tile.x))
      .replace('{y}', String(tile.y))
    const response = await this.request(`${url}?v=${revision}`, { signal })
    if (!response.ok && response.status !== 404)
      throw new Error(`Territory HTTP ${response.status}`)
    if (Number(response.headers.get('content-length')) > MAX_TILE_BYTES)
      throw new Error('Territory tile exceeds size limit')
    const buffer = response.status === 404 ? new ArrayBuffer(0) : await response.arrayBuffer()
    if (signal.aborted || this.revision !== revision) return
    const features = buffer.byteLength ? decodeTerritoryTile(buffer, tile) : []
    this.store(tile.key, {
      features,
      // Account for decoded JS objects as well as compressed wire bytes.
      bytes: Math.max(buffer.byteLength, JSON.stringify(features).length * 4),
      modified: Date.parse(response.headers.get('last-modified') ?? '') || 0,
    })
    this.failures.delete(tile.key)
  }

  private startTile(tile: TerritoryTile, revision: number): PendingTile {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timing.requestTimeoutMs)
    const pending = { controller, promise: Promise.resolve() }
    // intentional-suppression: completion records failed coverage and cooldown; the UI offers retry.
    pending.promise = untilAborted(
      this.fetchTile(tile, revision, controller.signal),
      controller.signal,
    )
      .catch(() => {})
      .finally(() => {
        clearTimeout(timeout)
        if (this.pending.get(tile.key) === pending) {
          this.pending.delete(tile.key)
          if (!this.entries.has(tile.key)) {
            this.failures.set(tile.key, Date.now() + this.timing.retryDelayMs)
            // Failed sparse/world pans must not grow memory without bound either.
            while (this.failures.size > CACHE_LIMIT)
              this.failures.delete(this.failures.keys().next().value!)
          }
        }
        this.releaseSlot()
      })
    this.pending.set(tile.key, pending)
    return pending
  }

  private releaseSlot() {
    this.active--
    for (const wake of [...this.waiters]) wake()
  }

  private async waitForSlot(signal: AbortSignal) {
    while (this.active >= REQUEST_CONCURRENCY && !signal.aborted) {
      let wake!: () => void
      const ready = new Promise<void>((resolve) => {
        wake = resolve
        this.waiters.add(wake)
      })
      await untilAborted(ready, signal)
      this.waiters.delete(wake)
    }
    if (signal.aborted) return false
    this.active++
    return true
  }

  private async ensureTile(tile: TerritoryTile, revision: number, signal: AbortSignal) {
    const cached = this.entries.get(tile.key)
    if (cached) {
      this.entries.delete(tile.key)
      this.entries.set(tile.key, cached)
      return
    }
    if ((this.failures.get(tile.key) ?? 0) > Date.now()) return
    let pending = this.pending.get(tile.key)
    if (!pending) {
      if (!(await this.waitForSlot(signal))) return
      if (
        signal.aborted ||
        revision !== this.revision ||
        this.entries.has(tile.key) ||
        (this.failures.get(tile.key) ?? 0) > Date.now()
      ) {
        this.releaseSlot()
        return
      }
      // Another viewport may have obtained the same tile while we were waiting.
      pending = this.pending.get(tile.key)
      if (pending) this.releaseSlot()
      else pending = this.startTile(tile, revision)
    }
    await untilAborted(pending.promise, signal)
  }

  async load(
    plan: TerritoryPlan,
    revision: number,
    signal: AbortSignal,
    onProgress?: (progress: TerritoryLoadProgress) => void,
  ): Promise<number> {
    if (signal.aborted) return plan.tiles.length
    this.setRevision(revision)
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal.addEventListener('abort', abort, { once: true })
    const deadline = setTimeout(abort, this.timing.loadTimeoutMs)
    let cursor = 0
    let lastProgress = 0
    const publish = (force = false) => {
      if (signal.aborted || this.revision !== revision) return
      if (force || Date.now() - lastProgress >= this.timing.progressIntervalMs) {
        lastProgress = Date.now()
        onProgress?.(this.coverage(plan, revision))
      }
    }
    const worker = async () => {
      while (
        !controller.signal.aborted &&
        this.revision === revision &&
        cursor < plan.tiles.length
      ) {
        await this.ensureTile(plan.tiles[cursor++], revision, controller.signal)
        publish()
      }
    }
    try {
      await Promise.all(Array.from({ length: REQUEST_CONCURRENCY }, worker))
      publish(true)
      return plan.tiles.length - this.coverage(plan, revision).loaded
    } finally {
      clearTimeout(deadline)
      signal.removeEventListener('abort', abort)
    }
  }

  coverage(plan: TerritoryPlan, expectedRevision = this.revision): TerritoryLoadProgress {
    const loaded =
      expectedRevision === this.revision
        ? plan.tiles.filter((tile) => this.entries.has(tile.key)).length
        : 0
    return { loaded, total: plan.tiles.length }
  }

  shape(viewport: TerritoryViewport, expectedRevision = this.revision) {
    return expectedRevision === this.revision
      ? mergeTerritoryTiles([...this.entries.values()], viewport)
      : EMPTY_TERRITORY
  }
}

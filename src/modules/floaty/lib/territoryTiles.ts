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

/** Memory-only public map cache. Recording, account data and uploads never pass here. */
export class TerritoryTileCache {
  private entries = new Map<string, TileData>()
  private revision: number | null = null
  private bytes = 0
  constructor(private request: (url: string, options?: RequestInit) => Promise<Response> = fetch) {}

  async load(
    plan: TerritoryPlan,
    revision: number,
    signal: AbortSignal,
    onProgress?: () => void,
  ): Promise<number> {
    if (revision !== this.revision) {
      this.entries.clear()
      this.bytes = 0
      this.revision = revision
    }
    let cursor = 0
    let failures = 0
    let completed = 0
    let showedFirstCells = false
    const worker = async () => {
      while (!signal.aborted && cursor < plan.tiles.length) {
        const tile = plan.tiles[cursor++]
        const cached = this.entries.get(tile.key)
        if (cached) {
          this.entries.delete(tile.key)
          this.entries.set(tile.key, cached)
          continue
        }
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 12000)
        const abort = () => controller.abort()
        signal.addEventListener('abort', abort)
        try {
          const url = TERRITORY_TILES.replace('{z}', String(TERRITORY_DETAIL_ZOOM))
            .replace('{x}', String(tile.x))
            .replace('{y}', String(tile.y))
          const response = await this.request(`${url}?v=${revision}`, { signal: controller.signal })
          if (!response.ok && response.status !== 404)
            throw new Error(`Territory HTTP ${response.status}`)
          if (Number(response.headers.get('content-length')) > MAX_TILE_BYTES)
            throw new Error('Territory tile exceeds size limit')
          const buffer = response.status === 404 ? new ArrayBuffer(0) : await response.arrayBuffer()
          const features = buffer.byteLength ? decodeTerritoryTile(buffer, tile) : []
          if (signal.aborted || this.revision !== revision) return
          const entry = {
            features,
            // Account for decoded JS objects as well as compressed wire bytes.
            bytes: Math.max(buffer.byteLength, JSON.stringify(features).length * 4),
            modified: Date.parse(response.headers.get('last-modified') ?? '') || 0,
          }
          this.entries.set(tile.key, entry)
          this.bytes += entry.bytes
          while (this.entries.size > CACHE_LIMIT || this.bytes > MAX_CACHE_BYTES) {
            const oldest = this.entries.keys().next().value
            if (oldest == null) break
            this.bytes -= this.entries.get(oldest)!.bytes
            this.entries.delete(oldest)
          }
          completed++
          if (completed % 16 === 0 || (!showedFirstCells && features.length > 0)) {
            showedFirstCells ||= features.length > 0
            onProgress?.()
          }
        } catch {
          if (!signal.aborted) failures++
        } finally {
          clearTimeout(timeout)
          signal.removeEventListener('abort', abort)
        }
      }
    }
    await Promise.all(Array.from({ length: 4 }, worker))
    return failures
  }
  shape(viewport: TerritoryViewport) {
    return mergeTerritoryTiles([...this.entries.values()], viewport)
  }
}

import { FillLayer, LineLayer, ShapeSource, SymbolLayer, VectorSource } from '@rnmapbox/maps'
import { useMemo } from 'react'
import { useResolvedAccentColors, useResolvedNeutralColors } from '@/hooks/useTheme'
import { useTerritoryTiles } from '../hooks/useTerritoryTiles'
import type { Coordinate } from '../lib/route'
import { territorySelection, type FloatyTerritorySelection } from '../lib/territory'
import { useTerritoryMapStore } from '../store/territoryMapStore'

export const HEATMAP_TILES = 'https://cdn.floaty-app.com/heatmap-tiles/{z}/{x}/{y}.pbf'
interface Props {
  territory: boolean
  heatmap: boolean
  route?: Coordinate[][]
  prefix?: string
  onTerritoryPress?: (selection: FloatyTerritorySelection) => void
}
/** Detailed ownership stays on one dataset across zooms; Mapbox draws every layer natively. */
export function FloatyMapLayers({
  territory,
  heatmap,
  route = [],
  prefix = 'floaty',
  onTerritoryPress,
}: Props) {
  const territoryShape = useTerritoryTiles(territory)
  const revision = useTerritoryMapStore((state) => state.revision)
  // A refresh remounts native sources. Keep the replacement's IDs distinct so an
  // old source/layer teardown cannot remove or reuse its new counterpart.
  const tilePrefix = `${prefix}-${revision}`
  const accents = useResolvedAccentColors()
  const neutral = useResolvedNeutralColors()
  const shape = useMemo<GeoJSON.Feature<GeoJSON.MultiLineString>>(
    () => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'MultiLineString', coordinates: route },
    }),
    [route],
  )
  return (
    <>
      {territory && (
        <ShapeSource
          id={`${prefix}-territory-detail`}
          shape={territoryShape}
          maxZoomLevel={14}
          tolerance={0}
          buffer={128}
          onPress={
            onTerritoryPress
              ? (event) => {
                  const selection = territorySelection(event.features)
                  if (selection) onTerritoryPress(selection)
                }
              : undefined
          }
        >
          <FillLayer
            id={`${prefix}-territory-fill`}
            filter={['==', ['get', 'isCell'], true]}
            style={{ fillColor: ['get', 'color'], fillOpacity: 0.22, fillAntialias: false }}
          />
          <LineLayer
            id={`${prefix}-territory-line`}
            filter={['==', ['get', 'isCell'], true]}
            style={{
              lineColor: ['get', 'color'],
              lineWidth: ['interpolate', ['linear'], ['zoom'], 8, 0, 12, 1],
              lineOffset: ['interpolate', ['linear'], ['zoom'], 8, 0, 12, 0.5],
              lineOpacity: 0.65,
            }}
          />
          <SymbolLayer
            id={`${prefix}-territory-overview-label`}
            maxZoomLevel={12}
            filter={['==', ['get', 'isOverviewLabel'], true]}
            style={{
              textField: ['get', 'clubName'],
              textMaxWidth: 12,
              textSize: 11,
              textColor: neutral.textPrimary,
              textHaloColor: neutral.bg,
              textHaloWidth: 1.5,
            }}
          />
          <SymbolLayer
            id={`${prefix}-territory-label`}
            minZoomLevel={12}
            filter={['==', ['get', 'isLabel'], true]}
            style={{
              textField: ['get', 'clubName'],
              textMaxWidth: 10,
              textSize: 11,
              textColor: neutral.textPrimary,
              textHaloColor: neutral.bg,
              textHaloWidth: 1,
            }}
          />
        </ShapeSource>
      )}
      {heatmap && (
        <VectorSource
          id={`${tilePrefix}-heatmap`}
          key={`heatmap-${revision}`}
          tileUrlTemplates={[`${HEATMAP_TILES}?v=${revision}`]}
          minZoomLevel={0}
          maxZoomLevel={14}
          attribution="Ride heatmap © Floaty"
        >
          <LineLayer
            id={`${tilePrefix}-heatmap-glow`}
            sourceLayerID="heatmap"
            style={{ lineColor: accents.orange.color, lineWidth: 6, lineBlur: 3, lineOpacity: 0.3 }}
          />
          <LineLayer
            id={`${tilePrefix}-heatmap-line`}
            sourceLayerID="heatmap"
            style={{
              lineColor: accents.orange.color,
              lineWidth: 2,
              lineOpacity: 0.8,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </VectorSource>
      )}
      {route.length > 0 && (
        <ShapeSource id={`${prefix}-ride`} shape={shape}>
          <LineLayer
            id={`${prefix}-ride-casing`}
            style={{ lineColor: neutral.bg, lineWidth: 7, lineCap: 'round', lineJoin: 'round' }}
          />
          <LineLayer
            id={`${prefix}-ride-line`}
            style={{
              lineColor: accents.sky.color,
              lineWidth: 4,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </ShapeSource>
      )}
    </>
  )
}

import { CircleLayer, FillLayer, Images, LineLayer, ShapeSource, SymbolLayer } from '@rnmapbox/maps'
import { useMemo } from 'react'
import { processColor } from 'react-native'

import { theme } from '@/constants/theme'
import { useResolvedAccentColors, useResolvedNeutralColors } from '@/hooks/useTheme'
import { RiderPresencePin, RiderTrail } from '@/modules/group-ride/components/RiderMapLayers'
import { useRiderStore } from '@/modules/group-ride/store/riderStore'
import { MAP_DEFAULTS } from '@/modules/map/constants/mapStyles'
import type { MainMapLayersProps } from '@/screens/main/map/mainMapLayerTypes'

const GPS_HEADING_ICON_ID = 'center-gps-heading'
const GPS_HEADING_ICON = require('@rnmapbox/maps/src/assets/heading.png')

export function LiveMapLayers({
  liveTrailShape,
  accuracyFix,
  accuracyShape,
  gpsPuckBearingDeg,
  riders,
  highContrastRoutes,
}: {
  liveTrailShape: MainMapLayersProps['liveTrailShape']
  accuracyFix: MainMapLayersProps['accuracyFix']
  accuracyShape: MainMapLayersProps['accuracyShape']
  gpsPuckBearingDeg: MainMapLayersProps['gpsPuckBearingDeg']
  riders: MainMapLayersProps['riders']
  highContrastRoutes: boolean
}) {
  const riderColor = useRiderStore((state) => state.riderColor)
  const neutral = useResolvedNeutralColors()
  const accents = useResolvedAccentColors()
  const accuracyFillColor = theme.alpha(accents.violet.color, 0.12)
  const gpsPointColor = riderColor ?? accents.purple.color
  const trailColor = riderColor ?? accents.violet.color
  const gpsPuckPositionShape = useMemo(
    () =>
      accuracyFix
        ? ({
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: [accuracyFix.longitude, accuracyFix.latitude],
            },
            properties: {},
          } as GeoJSON.Feature<GeoJSON.Point>)
        : null,
    [accuracyFix],
  )
  const gpsPuckShape = useMemo(
    () =>
      accuracyFix && gpsPuckBearingDeg != null
        ? ({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: {
                  type: 'Point',
                  coordinates: [accuracyFix.longitude, accuracyFix.latitude],
                },
                properties: { bearing: gpsPuckBearingDeg },
              },
            ],
          } as GeoJSON.FeatureCollection)
        : null,
    [accuracyFix, gpsPuckBearingDeg],
  )

  return (
    <>
      {liveTrailShape && (
        // This is the complete recording, including separate segments around pauses. Fading
        // line-progress makes every segment's beginning disappear and leaves only its dark
        // satellite casing. Preserve small loops at distant zooms and paint every segment fully.
        <ShapeSource id="center-live-trail-source" shape={liveTrailShape} tolerance={0}>
          <LineLayer
            id="center-live-trail-casing"
            style={{
              lineColor: theme.alpha(neutral.surfaceDeep, 0.85),
              lineWidth: highContrastRoutes ? MAP_DEFAULTS.trailWidth + 4 : 0,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
          <LineLayer
            id="center-live-trail-line"
            aboveLayerID="center-live-trail-casing"
            style={{
              lineColor: trailColor,
              lineWidth: MAP_DEFAULTS.trailWidth,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </ShapeSource>
      )}
      {accuracyFix && (
        <>
          {accuracyShape && (
            <ShapeSource id="center-gps-accuracy-source" shape={accuracyShape}>
              <FillLayer
                id="center-gps-accuracy-fill"
                style={{ fillColor: processColor(accuracyFillColor) as never }}
              />
            </ShapeSource>
          )}
          {gpsPuckPositionShape && (
            <ShapeSource id="center-gps-puck-position-source" shape={gpsPuckPositionShape}>
              <CircleLayer
                id="center-gps-puck-core"
                style={{
                  circleRadius: 8,
                  circleColor: gpsPointColor,
                  circleStrokeColor: theme.palette.mono.white,
                  circleStrokeWidth: 3,
                }}
              />
            </ShapeSource>
          )}
          {gpsPuckShape && (
            <>
              <Images images={{ [GPS_HEADING_ICON_ID]: { image: GPS_HEADING_ICON, sdf: true } }} />
              <ShapeSource id="center-gps-puck-heading-source" shape={gpsPuckShape}>
                <SymbolLayer
                  id="center-gps-puck-heading-outline"
                  style={{
                    iconImage: GPS_HEADING_ICON_ID,
                    iconRotate: ['get', 'bearing'],
                    iconAllowOverlap: true,
                    iconIgnorePlacement: true,
                    iconRotationAlignment: 'map',
                    iconSize: 0.95,
                    iconOffset: [0, -10],
                    iconColor: theme.palette.mono.white,
                  }}
                />
              </ShapeSource>
            </>
          )}
        </>
      )}
      {riders.map((rider, index) =>
        rider.trail && rider.trail.length >= 2 ? (
          <RiderTrail
            key={rider.id}
            rider={rider}
            index={index}
            highContrastRoutes={highContrastRoutes}
          />
        ) : null,
      )}
      {riders.map((rider, index) =>
        rider.presence ? <RiderPresencePin key={rider.id} rider={rider} index={index} /> : null,
      )}
    </>
  )
}

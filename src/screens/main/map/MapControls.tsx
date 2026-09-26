import { HexagonIcon } from 'phosphor-react-native'
import { IconButton } from '@/components/base/IconButton'
import { theme } from '@/constants/theme'
import { setFloatyPreferences, useFloatyStore } from '@/modules/floaty/store/floatyStore'
import { useState, type RefObject } from 'react'
import { InfoModal } from '@/components/modals/InfoModal'
import { useTriggerRef } from '@/components/overlays/measureTrigger'
import { CommunityMapDrawer } from './CommunityMapDrawer'
import { Pressable, StyleSheet, View } from 'react-native'
import type { SharedValue } from 'react-native-reanimated'

import { MapOrientationSelector } from '@/modules/map/components/MapOrientationSelector'
import { MapStyleSwitch } from '@/modules/map/components/MapStyleSwitch'
import type { MapOrientationMode, MapStyleKey } from '@/modules/map/constants/mapStyles'
import type { MainMapHandle } from '@/screens/main/map/MainMap'
import type { MapSelector } from '@/screens/main/mainScreenStore'
import type { MainViewState } from '@/screens/main/mainViewState'

interface MapControlsProps {
  mode: MainViewState
  mapRef: RefObject<MainMapHandle | null>
  heading: SharedValue<number>
  mapStyleKey: MapStyleKey
  setMapStyleKey: (key: MapStyleKey) => void
  mapOrientationMode: MapOrientationMode
  setMapOrientationMode: (mode: MapOrientationMode) => void
  mapSelector: MapSelector
  setMapSelector: (selector: MapSelector) => void
}

/** Main-map overlay, camera, and basemap controls pinned to the left edge. */
export function MapControls({
  mode,
  mapRef,
  heading,
  mapStyleKey,
  setMapStyleKey,
  mapOrientationMode,
  setMapOrientationMode,
  mapSelector,
  setMapSelector,
}: MapControlsProps) {
  const identity = useFloatyStore((state) => state.identity)
  const [communityOpen, setCommunityOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const communityTrigger = useTriggerRef()
  const territory = useFloatyStore((state) => state.preferences.territory)
  const showFloatyTiles = identity != null && mode !== 'weather' && mode !== 'legalLimits'
  const showNavigationSelector = mode !== 'history' && mode !== 'weather' && mode !== 'legalLimits'
  const navigationExpanded = showNavigationSelector && mapSelector === 'navigation'
  const styleExpanded = mapSelector === 'style'
  const selectorOpen = navigationExpanded || styleExpanded

  // Collapsing after a pick is the menu's own idle timer: it restarts on every tap, so the rider
  // can try basemaps one by one and the list only folds away once they stop.
  return (
    <View pointerEvents="box-none" style={styles.mapControlsLayer}>
      {selectorOpen ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close map selector"
          style={styles.mapSelectorDismissLayer}
          onPress={() => setMapSelector(null)}
        />
      ) : null}
      <View pointerEvents="box-none" style={styles.mapSelectors}>
        {showFloatyTiles && (
          <View ref={communityTrigger} collapsable={false}>
            <IconButton
              icon={HexagonIcon}
              accessibilityLabel={
                territory ? 'Hide Floaty territory tiles' : 'Show Floaty territory tiles'
              }
              accent={territory ? theme.palette.green.color : undefined}
              testID="main-floaty-button"
              accessibilityHint="Hold for map layers."
              onPress={() => {
                setMapSelector(null)
                try {
                  setFloatyPreferences({
                    territory: !useFloatyStore.getState().preferences.territory,
                  })
                } catch (failure) {
                  setError(
                    failure instanceof Error ? failure.message : 'Could not update map layers.',
                  )
                }
              }}
              onLongPress={() => {
                setMapSelector(null)
                setCommunityOpen(true)
              }}
            />
          </View>
        )}
        {showNavigationSelector ? (
          <MapOrientationSelector
            activeMode={mapOrientationMode}
            heading={heading}
            expanded={navigationExpanded}
            size="sm"
            onToggle={() => setMapSelector(mapSelector === 'navigation' ? null : 'navigation')}
            onSelect={(nextMode) => {
              if (mapOrientationMode === 'freeRotate' && nextMode !== 'freeRotate') {
                mapRef.current?.resetRotation()
              }
              setMapOrientationMode(nextMode)
            }}
          />
        ) : null}
        <MapStyleSwitch
          activeKey={mapStyleKey}
          expanded={styleExpanded}
          size="sm"
          onToggle={() => setMapSelector(mapSelector === 'style' ? null : 'style')}
          onSelect={setMapStyleKey}
        />
      </View>
      {identity && (
        <CommunityMapDrawer
          key={identity.uid}
          visible={communityOpen && showFloatyTiles}
          triggerRef={communityTrigger}
          onClose={() => setCommunityOpen(false)}
        />
      )}
      <InfoModal
        visible={error != null}
        title="Map layers"
        message={error ?? ''}
        onDismiss={() => setError(null)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  mapControlsLayer: {
    ...StyleSheet.absoluteFill,
    zIndex: 41,
  },
  mapSelectorDismissLayer: {
    ...StyleSheet.absoluteFill,
    zIndex: 1,
  },
  mapSelectors: {
    position: 'absolute',
    left: 12,
    top: '50%',
    marginTop: -42,
    zIndex: 30,
    alignItems: 'flex-start',
    gap: 8,
  },
})

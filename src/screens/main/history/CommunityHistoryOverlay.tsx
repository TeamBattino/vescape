import { useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { EdgeDrawer } from '@/components/overlays/EdgeDrawer'
import { InfoModal } from '@/components/modals/InfoModal'
import { theme } from '@/constants/theme'
import { FloatyRideBrowser } from '@/modules/floaty/components/FloatyRideBrowser'
import { useFloatyStore } from '@/modules/floaty/store/floatyStore'
import { FloatyRideDetail } from './FloatyRideDetail'
import { HistoryControls } from './HistoryControls'
import type { MainHistoryOverlayProps } from './HistoryOverlay'
import { openCommunityRide } from './communityEntry'

/** Shared rides use the same history chrome, with account-scoped browsing and no local editing. */
export function CommunityHistoryOverlay({
  visible,
  history,
  onPanelHeightChange,
}: {
  visible: boolean
  history: MainHistoryOverlayProps
  onPanelHeightChange: (height: number) => void
}) {
  const identity = useFloatyStore((state) => state.identity)
  const ride = useFloatyStore((state) => state.selectedRide)
  const [error, setError] = useState<string | null>(null)
  const listButtonRef = useRef<View>(null)
  const selectTab = history.selectHistoryTab
  useEffect(() => {
    if (!identity) selectTab('history')
  }, [identity, selectTab])
  const busy =
    history.loadingSession ||
    history.historyLoading ||
    history.favoritesLoading ||
    history.favoritesSaving
  const browserVisible = visible && history.historySheetVisible
  const openList = () => history.setHistorySheetVisible(true)
  return (
    <>
      {visible && identity && ride ? (
        <FloatyRideDetail
          ride={ride}
          onOpenList={openList}
          onBack={history.exitHistory}
          onPanelHeightChange={onPanelHeightChange}
          listButtonRef={listButtonRef}
          onSelectTab={selectTab}
        />
      ) : visible ? (
        <>
          <View style={styles.empty}>
            <Text style={styles.caption}>Choose a shared ride to view its route and summary.</Text>
            <Button label="Browse community rides" onPress={openList} />
          </View>
          <HistoryControls
            loading={busy}
            tab="community"
            canRemove={false}
            trimming={false}
            saving={false}
            trimName=""
            onTrimNameChange={() => undefined}
            onSelectTab={selectTab}
            onBack={history.exitHistory}
            onOpenActions={() => undefined}
            onCancelTrim={() => undefined}
            onSaveTrim={() => undefined}
          />
        </>
      ) : null}
      {identity && (
        <EdgeDrawer
          visible={browserVisible}
          triggerRef={listButtonRef}
          onClose={() => history.setHistorySheetVisible(false)}
          title="Community rides"
          dismissalMode="explicit"
          scrollable={false}
        >
          <FloatyRideBrowser
            key={identity.uid}
            uid={identity.uid}
            active={browserVisible}
            onSelectRide={(selected) => {
              try {
                openCommunityRide(selected, identity.uid)
              } catch (failure) {
                setError(failure instanceof Error ? failure.message : 'Could not open ride.')
              }
            }}
          />
        </EdgeDrawer>
      )}
      <InfoModal
        visible={error != null}
        title="Community ride"
        message={error ?? ''}
        onDismiss={() => setError(null)}
      />
    </>
  )
}
const styles = StyleSheet.create({
  empty: { position: 'absolute', left: 24, right: 24, bottom: 80, gap: 12 },
  caption: { color: theme.neutral.textSecondary, fontSize: 14, textAlign: 'center' },
})

import { useState, type RefObject } from 'react'
import { StyleSheet, View } from 'react-native'
import { MapTrifoldIcon } from 'phosphor-react-native'
import { EdgeDrawer } from '@/components/overlays/EdgeDrawer'
import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { Switch } from '@/components/controls/Switch'
import { theme } from '@/constants/theme'
import { setFloatyPreferences, useFloatyStore } from '@/modules/floaty/store/floatyStore'
import { refreshTerritoryTiles } from '@/modules/floaty/store/territoryMapStore'
import { openCommunityRides } from '@/screens/main/history/communityEntry'
export function CommunityMapDrawer({
  visible,
  triggerRef,
  onClose,
}: {
  visible: boolean
  triggerRef: RefObject<View | null>
  onClose: () => void
}) {
  const preferences = useFloatyStore((state) => state.preferences)
  const [error, setError] = useState<string | null>(null)
  const toggle = (key: 'territory' | 'heatmap', value: boolean) => {
    try {
      setFloatyPreferences({ [key]: value })
      setError(null)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not update layers.')
    }
  }
  return (
    <EdgeDrawer
      visible={visible}
      triggerRef={triggerRef}
      onClose={onClose}
      title="Map layers"
      icon={MapTrifoldIcon}
      dismissalMode="explicit"
    >
      <View style={styles.row}>
        <Text style={styles.label}>Club territory</Text>
        <Switch
          accessibilityLabel="Show club territory"
          value={preferences.territory}
          onValueChange={(value) => toggle('territory', value)}
        />
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Community heatmap</Text>
        <Switch
          accessibilityLabel="Show community heatmap"
          value={preferences.heatmap}
          onValueChange={(value) => toggle('heatmap', value)}
        />
      </View>
      <Button
        label="Reload published tiles"
        variant="secondary"
        size="sm"
        onPress={refreshTerritoryTiles}
      />
      <Text style={styles.caption}>
        Club colors and names use the same detailed data at every zoom. Wide views show loaded
        areas.
      </Text>
      <Button
        label="Browse rides"
        variant="secondary"
        onPress={() => {
          onClose()
          openCommunityRides()
        }}
      />
      {error ? <Text style={styles.caption}>{error}</Text> : null}
    </EdgeDrawer>
  )
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  label: { color: theme.neutral.textPrimary, fontSize: 14 },
  caption: { color: theme.neutral.textSecondary, fontSize: 12, lineHeight: 18 },
})

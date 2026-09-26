import { StyleSheet, View } from 'react-native'
import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { FadeCardModal } from '@/components/modals/FadeCardModal'
import { theme } from '@/constants/theme'
import { territoryDescription, type FloatyTerritorySelection } from '../lib/territory'
import { refreshTerritoryTiles } from '../store/territoryMapStore'

export function FloatyTerritoryDetails({
  selection,
  onDismiss,
}: {
  selection: FloatyTerritorySelection | null
  onDismiss: () => void
}) {
  return (
    <FadeCardModal
      visible={selection != null}
      title={selection?.clubName ?? 'Floaty territory'}
      onDismiss={onDismiss}
      footer={
        <View style={styles.actions}>
          <Button
            label="Reload tiles"
            variant="secondary"
            style={styles.button}
            onPress={() => {
              refreshTerritoryTiles()
              onDismiss()
            }}
          />
          <Button label="Close" style={styles.button} onPress={onDismiss} />
        </View>
      }
    >
      <Text style={styles.message} selectable>
        {selection ? territoryDescription(selection) : ''}
      </Text>
    </FadeCardModal>
  )
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 10 },
  button: { flex: 1 },
  message: { color: theme.neutral.textSecondary, fontSize: 13, lineHeight: 19 },
})

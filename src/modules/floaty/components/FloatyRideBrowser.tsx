import { useEffect, useRef, useState } from 'react'
import { FlatList, StyleSheet, View } from 'react-native'
import { MagnifyingGlassIcon, MapTrifoldIcon } from 'phosphor-react-native'
import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { Input } from '@/components/forms/Input'
import { theme } from '@/constants/theme'
import { useFormat } from '@/hooks/useFormat'
import { floatyClient, useFloatyStore } from '@/modules/floaty/store/floatyStore'
import { createRideBrowser, emptyRideBrowserState } from '@/modules/floaty/lib/rideBrowser'
import type { FloatyRide } from '@/modules/floaty/lib/types'

interface Props {
  uid: string
  active?: boolean
  onSelectRide: (ride: FloatyRide) => void
}

/** Owns one FlatList; mount directly in a bounded drawer, never inside its ScrollView. */
export function FloatyRideBrowser(props: Props) {
  return <AccountRideBrowser key={props.uid} {...props} />
}

function AccountRideBrowser({ uid, active = true, onSelectRide }: Props) {
  const { formatDistance } = useFormat()
  const [username, setUsername] = useState('')
  const [state, setState] = useState(emptyRideBrowserState)
  const browser = useRef<ReturnType<typeof createRideBrowser> | null>(null)
  useEffect(() => {
    if (!active) return
    const controller = createRideBrowser({
      uid,
      client: floatyClient,
      publish: setState,
      currentUid: () => useFloatyStore.getState().identity?.uid,
    })
    browser.current = controller
    void controller.own()
    return () => {
      controller.dispose()
      browser.current = null
    }
  }, [uid, active])
  const search = () => void browser.current?.search(username)
  return (
    <FlatList
      style={styles.list}
      data={state.rides}
      keyExtractor={(ride) => ride.id}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={styles.content}
      initialNumToRender={8}
      windowSize={7}
      ListHeaderComponent={
        <View style={styles.header}>
          <View style={styles.search}>
            <Input
              style={styles.input}
              accessibilityLabel="Floaty username"
              placeholder="Find a rider by exact username"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={search}
            />
            <Button
              label="Find"
              icon={MagnifyingGlassIcon}
              size="sm"
              disabled={!username.trim()}
              onPress={search}
            />
          </View>
          <View style={styles.search}>
            {state.query && (
              <Button
                label="My rides"
                variant="secondary"
                size="sm"
                onPress={() => {
                  setUsername('')
                  void browser.current?.own()
                }}
              />
            )}
            <Button
              label="Refresh rides"
              variant="secondary"
              size="sm"
              loading={state.loading && !state.loadingMore}
              onPress={() => void browser.current?.refresh()}
            />
          </View>
          <Text style={styles.heading}>
            {state.rider?.displayName ??
              (state.query ? `Rides by ${state.query}` : 'My Floaty rides')}
          </Text>
          <Text style={styles.muted}>
            Rides shared through Floaty. Private routes stay private.
          </Text>
          {state.error && (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {state.error}
            </Text>
          )}
        </View>
      }
      ListEmptyComponent={
        <Text style={styles.muted}>
          {state.loading
            ? 'Loading rides…'
            : state.error
              ? 'Refresh rides to try again.'
              : 'No shared rides found.'}
        </Text>
      }
      renderItem={({ item: ride }) => (
        <View style={styles.ride}>
          <Text style={styles.label}>{ride.name}</Text>
          <Text style={styles.muted}>
            {new Date(ride.startTime).toLocaleDateString()} · {formatDistance(ride.distance * 1000)}{' '}
            · {Math.max(0, Math.round((ride.endTime - ride.startTime) / 60_000))} min
          </Text>
          <Button
            label={ride.polyline ? 'View ride' : 'Route not shared'}
            icon={MapTrifoldIcon}
            variant="secondary"
            size="sm"
            disabled={!ride.polyline}
            onPress={() => {
              if (active && useFloatyStore.getState().identity?.uid === uid) onSelectRide(ride)
            }}
          />
        </View>
      )}
      ListFooterComponent={
        state.next ? (
          <Button
            label="Load older rides"
            variant="secondary"
            loading={state.loadingMore}
            disabled={state.loading && !state.loadingMore}
            onPress={() => void browser.current?.loadMore()}
          />
        ) : null
      }
    />
  )
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  header: { gap: 12, paddingBottom: 16 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1 },
  label: { color: theme.neutral.textPrimary, fontSize: 14, fontWeight: '600' },
  heading: { color: theme.neutral.textPrimary, fontSize: 18, fontWeight: '600' },
  muted: { color: theme.neutral.textSecondary, fontSize: 12, lineHeight: 18 },
  error: { color: theme.status.error.text, fontSize: 13, lineHeight: 19 },
  ride: { paddingVertical: 16, gap: 8, borderTopWidth: 1, borderColor: theme.neutral.border },
})

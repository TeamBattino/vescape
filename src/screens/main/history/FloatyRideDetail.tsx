import { useRef, type RefObject } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { DASH } from '@/helpers/format'
import { useFormat } from '@/hooks/useFormat'
import type { FloatyRide } from '@/modules/floaty/lib/types'
import { HistoryPanelNav } from '@/modules/history/components/HistoryPanelNav'
import { formatRideDate, formatRideTime } from '@/modules/history/lib/rideFormat'
import { HistoryControls } from '@/screens/main/history/HistoryControls'
import type { HistoryTab } from '@/screens/main/mainScreenStore'

const noop = () => {}

/** A shared route and summary, without inventing a local recording or telemetry replay. */
export function FloatyRideDetail({
  ride,
  onOpenList,
  onBack,
  onPanelHeightChange,
  listButtonRef,
  onSelectTab,
}: {
  ride: FloatyRide
  onOpenList: () => void
  onBack: () => void
  onPanelHeightChange: (height: number) => void
  listButtonRef: RefObject<View | null>
  onSelectTab: (tab: HistoryTab) => void
}) {
  const insets = useSafeAreaInsets()
  const bottomInset = Math.max(insets.bottom, 16) + 8
  const mediaButtonRef = useRef<View>(null)
  const { formatDistance, formatSpeedWithUnit } = useFormat()
  const validTime =
    Number.isFinite(ride.startTime) &&
    Number.isFinite(ride.endTime) &&
    ride.endTime >= ride.startTime
  const elapsedMinutes = validTime ? Math.round((ride.endTime - ride.startTime) / 60_000) : null
  const elapsed =
    elapsedMinutes == null
      ? DASH
      : elapsedMinutes >= 60
        ? `${Math.floor(elapsedMinutes / 60)} h ${elapsedMinutes % 60} min`
        : `${elapsedMinutes} min`
  const stats = [
    {
      label: 'Distance',
      value:
        Number.isFinite(ride.distance) && ride.distance >= 0
          ? formatDistance(ride.distance * 1000)
          : DASH,
    },
    { label: 'Elapsed time', value: elapsed },
    {
      label: 'Top speed',
      value:
        Number.isFinite(ride.topSpeed) && ride.topSpeed >= 0
          ? formatSpeedWithUnit(ride.topSpeed, 1)
          : DASH,
    },
  ]
  return (
    <>
      <HistoryControls
        loading={false}
        tab="community"
        canRemove={false}
        trimming={false}
        saving={false}
        trimName=""
        onTrimNameChange={noop}
        onSelectTab={onSelectTab}
        onBack={onBack}
        onOpenActions={noop}
        onCancelTrim={noop}
        onSaveTrim={noop}
      />
      <View
        style={[styles.panel, { bottom: bottomInset }]}
        onLayout={(event) =>
          onPanelHeightChange(Math.round(event.nativeEvent.layout.height + bottomInset))
        }
      >
        <HistoryPanelNav
          readOnly
          titleStartMs={ride.startTime}
          titleEndMs={ride.endTime}
          title={ride.name}
          subtitle={
            validTime
              ? `${formatRideDate(ride.startTime, ride.endTime)} · ${formatRideTime(ride.startTime, ride.endTime)}`
              : 'Floaty ride'
          }
          boardName=""
          canPrevious={false}
          canNext={false}
          favoriteMode={false}
          favorited={false}
          actionDisabled
          mediaCount={0}
          mediaLoading={false}
          mediaButtonRef={mediaButtonRef}
          listButtonRef={listButtonRef}
          onPrevious={noop}
          onNext={noop}
          onOpenList={onOpenList}
          onOpenMediaDrawer={noop}
          onToggleFavorite={noop}
          onOpenShareInfo={noop}
          onOpenCharts={noop}
        />
        <View style={styles.summary}>
          <View style={styles.stats}>
            {stats.map((stat) => (
              <View key={stat.label} style={styles.stat}>
                <Text style={styles.label}>{stat.label}</Text>
                <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
                  {stat.value}
                </Text>
              </View>
            ))}
          </View>
          <Text style={styles.note}>
            Floaty shares the route and ride summary. Speed and duty-cycle replay are unavailable.
          </Text>
        </View>
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  panel: { position: 'absolute', left: 8, right: 8, zIndex: 20, gap: 8 },
  summary: {
    padding: 12,
    gap: 12,
    borderRadius: 16,
    backgroundColor: theme.neutral.surface,
    borderWidth: 1,
    borderColor: theme.neutral.border,
  },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, minWidth: 0, gap: 4 },
  label: {
    color: theme.neutral.textMuted,
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  value: {
    color: theme.neutral.textPrimary,
    fontFamily: 'monospace',
    fontSize: 15,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  note: { color: theme.neutral.textSecondary, fontSize: 12, lineHeight: 17 },
})

import { decodeRouteSegments } from '@/modules/floaty/lib/route'
import type { FloatyRide } from '@/modules/floaty/lib/types'
import { useFloatyStore } from '@/modules/floaty/store/floatyStore'
import { useMainScreenStore } from '@/screens/main/mainScreenStore'

export function openCommunityRides() {
  if (!useFloatyStore.getState().identity) return
  const screen = useMainScreenStore.getState()
  screen.enterHistory()
  screen.setHistoryTab('community')
  screen.setHistorySheetVisible(true)
}

export function openCommunityRide(ride: FloatyRide, accountUid: string) {
  if (useFloatyStore.getState().identity?.uid !== accountUid)
    throw new Error('Reconnect your Floaty account.')
  if (!ride.polyline || !decodeRouteSegments(ride.polyline).some((segment) => segment.length >= 2))
    throw new Error('This ride has no shared GPS route to display.')
  useFloatyStore.setState({ selectedRide: ride })
  const screen = useMainScreenStore.getState()
  screen.enterHistory()
  screen.setHistoryTab('community')
  screen.setHistorySheetVisible(false)
}

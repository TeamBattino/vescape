import { AppState } from 'react-native'
import { isRideStillRecording } from '@/modules/floaty/lib/uploadReadiness'
import { getRideHistoryPage, getLiveState, addLiveStateListener } from 'vescape-core'
import {
  enqueueFloatyRide,
  initializeFloaty,
  processFloatyQueue,
  reportFloatyError,
  useFloatyStore,
} from '@/modules/floaty/store/floatyStore'

/** Native continues recording while JS sleeps. Foreground catch-up discovers completed rides. */
export function startFloatySync() {
  let running = false,
    stopped = false
  async function sync() {
    if (running || stopped || AppState.currentState !== 'active') return
    running = true
    try {
      await initializeFloaty()
      const { identity, preferences } = useFloatyStore.getState()
      if (identity && preferences.autoUpload && preferences.autoUploadUid === identity.uid) {
        let cursor: number | undefined
        for (let pageIndex = 0; pageIndex < 100 && !stopped; pageIndex++) {
          const page = await getRideHistoryPage({ limit: 50, cursorBeforeMs: cursor })
          for (const ride of page.sessions) {
            const current = useFloatyStore.getState()
            if (!current.preferences.autoUpload || current.identity?.uid !== identity.uid) break
            if (
              ride.startAtMs < preferences.autoUploadSince ||
              isRideStillRecording(ride, getLiveState().recording) ||
              ride.preciseGpsPointCount < 2
            )
              continue
            // A long paused recording can have old samples and still be open natively.
            try {
              await enqueueFloatyRide(ride, identity.uid)
            } catch (error) {
              if (!(error instanceof Error) || !error.message.includes('still recording'))
                throw error
            }
          }
          if (
            !page.hasMore ||
            page.nextCursorBeforeMs == null ||
            page.nextCursorBeforeMs === cursor ||
            page.sessions.some((ride) => ride.startAtMs < preferences.autoUploadSince)
          )
            break
          cursor = page.nextCursorBeforeMs
        }
      }
      await processFloatyQueue()
    } catch (error) {
      reportFloatyError(error)
    } finally {
      running = false
    }
  }
  void sync()
  let recordingEnabled = getLiveState().recording.enabled
  const recordingSubscription = addLiveStateListener((state) => {
    const ended = recordingEnabled && !state.recording.enabled
    recordingEnabled = state.recording.enabled
    if (ended) void sync()
  })
  const timer = setInterval(() => void sync(), 30_000)
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') void sync()
  })
  return () => {
    stopped = true
    clearInterval(timer)
    subscription.remove()
    recordingSubscription.remove()
  }
}

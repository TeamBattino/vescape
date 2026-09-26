import { useEffect, useState } from 'react'
import { AppState } from 'react-native'
import { addLiveStateListener, getHistoryRange, getLiveState } from 'vescape-core'

import { createRecordedLiveTrail, type LiveTrailShape } from '@/modules/map/lib/recordedLiveTrail'

export function useRecordedLiveTrail() {
  const [trail, setTrail] = useState<{ active: boolean; shape: LiveTrailShape | null }>(() => ({
    active: getLiveState().recording.enabled,
    shape: null,
  }))
  useEffect(() => {
    const recovery = createRecordedLiveTrail(getHistoryRange, setTrail)
    const refresh = () => {
      recovery.setRecording(getLiveState().recording)
      if (AppState.currentState === 'active') {
        // intentional-suppression: keep the last verified route on a transient read failure; next tick/foreground retries.
        void recovery.refresh(Date.now()).catch(() => {})
      }
    }
    refresh()
    const live = addLiveStateListener((state) => {
      if (recovery.setRecording(state.recording)) refresh()
    })
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh()
    })
    const interval = setInterval(refresh, 5_000)
    return () => {
      recovery.dispose()
      live.remove()
      app.remove()
      clearInterval(interval)
    }
  }, [])
  return trail
}

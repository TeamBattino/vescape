import { useEffect, useMemo, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { EMPTY_TERRITORY, TerritoryTileCache, territoryTilePlan } from '../lib/territoryTiles'
import { retryTerritoryTiles, useTerritoryMapStore } from '../store/territoryMapStore'

// Public, bounded memory cache survives switching map modes. It holds no account data.
const cache = new TerritoryTileCache()

function waitForRetry(signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, 16_000)
    signal.addEventListener('abort', finish, { once: true })
    if (signal.aborted) finish()
  })
}

export function useTerritoryTiles(enabled: boolean) {
  const viewport = useTerritoryMapStore((state) => state.viewport)
  const revision = useTerritoryMapStore((state) => state.revision)
  const retryRequest = useTerritoryMapStore((state) => state.retryRequest)
  const [result, setResult] = useState({ revision, shape: EMPTY_TERRITORY })
  const plan = useMemo(() => (viewport ? territoryTilePlan(viewport) : null), [viewport])
  const planKey =
    plan?.tiles
      .map((tile) => tile.key)
      .sort()
      .join(';') ?? ''
  const latest = useRef({ viewport, plan })
  useEffect(() => {
    latest.current = { viewport, plan }
  }, [viewport, plan])
  useEffect(() => {
    if (!enabled) return
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') retryTerritoryTiles()
    })
    return () => subscription.remove()
  }, [enabled])
  useEffect(() => {
    const current = latest.current
    if (!enabled || !current.viewport || !current.plan) {
      useTerritoryMapStore.setState({ loadStatus: null, canRetry: false })
      return
    }
    const view = current.viewport
    const requested = current.plan
    const controller = new AbortController()
    const publish = () => {
      if (controller.signal.aborted) return false
      try {
        setResult({ revision, shape: cache.shape(view, revision) })
        return true
      } catch {
        // A bad public geometry must not crash the map, including the immediate cache render
        // before the asynchronous load starts. Keep the last valid shape available for retry.
        useTerritoryMapStore.setState({
          loadStatus: 'Territory unavailable · Tap to retry',
          canRetry: true,
        })
        return false
      }
    }
    publish()
    const run = async () => {
      try {
        for (let attempt = 0; attempt < 3 && !controller.signal.aborted; attempt++) {
          const progress = ({ loaded, total }: { loaded: number; total: number }) => {
            if (controller.signal.aborted) return
            if (!publish()) return
            useTerritoryMapStore.setState({
              loadStatus:
                loaded < total
                  ? `Loading territory · ${Math.round((loaded / total) * 100)}%`
                  : null,
              canRetry: false,
            })
          }
          progress(cache.coverage(requested, revision))
          const remaining = await cache.load(requested, revision, controller.signal, progress)
          if (controller.signal.aborted) return
          if (!publish()) return
          useTerritoryMapStore.setState({
            loadStatus: remaining
              ? 'Some territory unavailable · Tap to retry'
              : requested.limited
                ? 'Loaded territory · Zoom in for full coverage'
                : null,
            canRetry: remaining > 0,
          })
          if (!remaining || attempt === 2) return
          await waitForRetry(controller.signal)
        }
      } catch {
        if (!controller.signal.aborted)
          useTerritoryMapStore.setState({
            loadStatus: 'Territory unavailable · Tap to retry',
            canRetry: true,
          })
      }
    }
    const timer = setTimeout(() => {
      void run()
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [enabled, planKey, plan?.limited, revision, retryRequest])
  return result.revision === revision ? result.shape : EMPTY_TERRITORY
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { EMPTY_TERRITORY, TerritoryTileCache, territoryTilePlan } from '../lib/territoryTiles'
import { useTerritoryMapStore } from '../store/territoryMapStore'

export function useTerritoryTiles(enabled: boolean) {
  const viewport = useTerritoryMapStore((state) => state.viewport)
  const revision = useTerritoryMapStore((state) => state.revision)
  const [cache] = useState(() => new TerritoryTileCache())
  const [result, setResult] = useState({ revision, shape: EMPTY_TERRITORY })
  const plan = useMemo(() => (viewport ? territoryTilePlan(viewport) : null), [viewport])
  // Follow-camera updates within the same tile rectangle don't start another load.
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
    const current = latest.current
    if (!enabled || !current.viewport || !current.plan) {
      useTerritoryMapStore.setState({ loadStatus: null })
      return
    }
    const controller = new AbortController()
    const run = async () => {
      useTerritoryMapStore.setState({ loadStatus: 'Loading club territory…' })
      try {
        const failures = await cache.load(current.plan!, revision, controller.signal, () => {
          if (!controller.signal.aborted)
            setResult({ revision, shape: cache.shape(current.viewport!) })
        })
        if (controller.signal.aborted) return
        const shape = cache.shape(current.viewport!)
        setResult({ revision, shape })
        useTerritoryMapStore.setState({
          loadStatus: failures
            ? 'Some territory could not load · Reload from map layers'
            : current.plan!.limited
              ? 'Showing loaded club territory · Zoom in for full coverage'
              : null,
        })
      } catch {
        if (!controller.signal.aborted)
          useTerritoryMapStore.setState({
            loadStatus: 'Territory unavailable · Reload from map layers',
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
  }, [enabled, planKey, plan?.limited, revision, cache])
  return result.revision === revision ? result.shape : EMPTY_TERRITORY
}

import { create } from 'zustand'
import type { TerritoryViewport } from '../lib/territoryTiles'
import type { FloatyTerritorySelection } from '../lib/territory'

/** Transient map UI only; nothing here represents server processing or tile credit. */
export const useTerritoryMapStore = create<{
  selected: FloatyTerritorySelection | null
  revision: number
  viewport: TerritoryViewport | null
  loadStatus: string | null
  canRetry: boolean
  retryRequest: number
}>(() => ({
  selected: null,
  revision: Date.now(),
  viewport: null,
  loadStatus: null,
  canRetry: false,
  retryRequest: 0,
}))

export function refreshTerritoryTiles() {
  useTerritoryMapStore.setState((state) => ({
    selected: null,
    revision: Math.max(Date.now(), state.revision + 1),
  }))
}

/** Retry missing areas without discarding already loaded ownership. */
export function retryTerritoryTiles() {
  useTerritoryMapStore.setState((state) => ({ retryRequest: state.retryRequest + 1 }))
}

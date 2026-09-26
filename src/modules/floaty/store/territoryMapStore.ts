import { create } from 'zustand'
import type { TerritoryViewport } from '../lib/territoryTiles'
import type { FloatyTerritorySelection } from '../lib/territory'

/** Transient map UI only; nothing here represents server processing or tile credit. */
export const useTerritoryMapStore = create<{
  selected: FloatyTerritorySelection | null
  revision: number
  viewport: TerritoryViewport | null
  loadStatus: string | null
}>(() => ({ selected: null, revision: Date.now(), viewport: null, loadStatus: null }))

export function refreshTerritoryTiles() {
  useTerritoryMapStore.setState((state) => ({
    selected: null,
    revision: Math.max(Date.now(), state.revision + 1),
  }))
}

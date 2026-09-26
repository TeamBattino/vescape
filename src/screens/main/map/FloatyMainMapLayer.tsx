import { useEffect } from 'react'
import { FloatyMapLayers } from '@/modules/floaty/components/FloatyMapLayers'
import { useFloatyStore } from '@/modules/floaty/store/floatyStore'
import { useTerritoryMapStore } from '@/modules/floaty/store/territoryMapStore'
export function FloatyMainMapLayer({
  onSuppressNextMapPress,
}: {
  onSuppressNextMapPress: () => void
}) {
  useEffect(() => () => useTerritoryMapStore.setState({ selected: null }), [])
  const identity = useFloatyStore((state) => state.identity)
  const territory = useFloatyStore((state) => state.preferences.territory)
  const heatmap = useFloatyStore((state) => state.preferences.heatmap)
  if (!identity) return null
  return (
    <FloatyMapLayers
      territory={territory}
      heatmap={heatmap}
      prefix="main-floaty"
      onTerritoryPress={(selected) => {
        onSuppressNextMapPress()
        useTerritoryMapStore.setState({ selected })
      }}
    />
  )
}

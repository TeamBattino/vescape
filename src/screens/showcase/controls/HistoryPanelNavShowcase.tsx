import { useRef, useState } from 'react'
import type { View } from 'react-native'
import { Text } from '@/components/base/Text'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ToggleRow } from '@/components/dev/ShowcaseControls'
import { HistoryPanelNav } from '@/modules/history/components/HistoryPanelNav'

export function HistoryPanelNavShowcase() {
  const [readOnly, setReadOnly] = useState(true)
  const [lastAction, setLastAction] = useState('Tap the ride title to open its list')
  const listButtonRef = useRef<View>(null)
  const mediaButtonRef = useRef<View>(null)
  return (
    <ShowcaseCard name="HistoryPanelNav">
      <ToggleRow label="Shared ride (read only)" value={readOnly} onToggle={setReadOnly} />
      <HistoryPanelNav
        readOnly={readOnly}
        title="Riverside evening ride"
        subtitle="24 Sep 2026 · 18:10 – 18:45"
        titleStartMs={0}
        titleEndMs={0}
        boardName=""
        canPrevious
        canNext
        favoriteMode={false}
        favorited={false}
        actionDisabled={false}
        mediaCount={0}
        mediaLoading={false}
        listButtonRef={listButtonRef}
        mediaButtonRef={mediaButtonRef}
        onPrevious={() => setLastAction('Previous ride')}
        onNext={() => setLastAction('Next ride')}
        onOpenList={() => setLastAction('Ride list opened')}
        onOpenCharts={() => setLastAction('Charts opened')}
        onOpenMediaDrawer={() => setLastAction('Media opened')}
        onToggleFavorite={() => setLastAction('Favorite selected')}
        onOpenShareInfo={() => setLastAction('Share opened')}
      />
      <Text>{lastAction}</Text>
    </ShowcaseCard>
  )
}

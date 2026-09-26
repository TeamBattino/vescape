import { useEffect, useState } from 'react'
import { View, StyleSheet } from 'react-native'
import {
  cancelAnimation,
  Easing,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'

import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ChipRow, ToggleRow } from '@/components/dev/ShowcaseControls'
import { FootpadIndicator } from '@/modules/board/components/FootpadIndicator'

const WIDTHS: Record<string, number> = { strip: 26, medium: 64, detail: 132 }
/** Refloat's own default `fault_adc`, a high one, a disabled zone, and no config at all. */
const THRESHOLDS: Record<string, number | null> = {
  '0.8': 0.8,
  '2.0': 2,
  'off (0)': 0,
  'no config': null,
}

export function FootpadIndicatorShowcase() {
  const [size, setSize] = useState('detail')
  const [threshold2, setThreshold2] = useState('0.8')
  const [signal, setSignal] = useState('sweep')
  const [posi, setPosi] = useState(false)
  const adc1 = useSharedValue<number | null>(null)
  const adc2 = useSharedValue<number | null>(null)

  useEffect(() => {
    cancelAnimation(adc1)
    cancelAnimation(adc2)
    if (signal !== 'sweep') {
      adc1.set(signal === 'no data' ? null : signal === 'left only' || signal === 'both' ? 3.3 : 0)
      adc2.set(signal === 'no data' ? null : signal === 'right only' || signal === 'both' ? 3.3 : 0)
      return
    }
    // Two sweeps of different length, so the zones are usually out of step — that difference is the
    // thing the two rails exist to show.
    adc1.set(0)
    adc2.set(0)
    adc1.set(
      withRepeat(withTiming(3.3, { duration: 2600, easing: Easing.inOut(Easing.quad) }), -1, true),
    )
    adc2.set(
      withRepeat(withTiming(3.3, { duration: 4100, easing: Easing.inOut(Easing.quad) }), -1, true),
    )
    return () => {
      cancelAnimation(adc1)
      cancelAnimation(adc2)
    }
  }, [signal, adc1, adc2])

  return (
    <ShowcaseCard
      name="FootpadIndicator"
      controls={
        <>
          <ChipRow label="width" options={Object.keys(WIDTHS)} selected={size} onSelect={setSize} />
          <ChipRow
            label="right zone (ADC2) fault_adc"
            options={Object.keys(THRESHOLDS)}
            selected={threshold2}
            onSelect={setThreshold2}
          />
          <ChipRow
            label="sensor signal"
            options={['sweep', 'left only', 'right only', 'both', 'off', 'no data']}
            selected={signal}
            onSelect={setSignal}
          />
          <ToggleRow label="posi (both sensors as one)" value={posi} onToggle={setPosi} />
        </>
      }
    >
      <View style={styles.row}>
        <FootpadIndicator
          adc1={adc1}
          adc2={adc2}
          posi={posi}
          showValues={size === 'detail'}
          threshold1={0.8}
          threshold2={THRESHOLDS[threshold2] ?? null}
          width={WIDTHS[size] ?? 132}
        />
      </View>
    </ShowcaseCard>
  )
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    paddingVertical: 12,
  },
})

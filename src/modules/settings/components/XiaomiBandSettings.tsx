import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { getXiaomiBandStatus, configureXiaomiBand, openXiaomiBand } from 'vescape-core'
import { Text } from '@/components/base/Text'
import { Button } from '@/components/base/Button'
import { Input } from '@/components/forms/Input'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { theme } from '@/constants/theme'

export function XiaomiBandSettings() {
  const [status, setStatus] = useState(getXiaomiBandStatus)
  const [deviceId, setDeviceId] = useState(status.nodeId ?? '')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const timer = setInterval(() => setStatus(getXiaomiBandStatus()), 1000)
    return () => clearInterval(timer)
  }, [])
  const connect = () => {
    try {
      configureXiaomiBand(deviceId.trim())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to connect')
    }
  }
  return (
    <SettingsCard>
      <View style={styles.content}>
        <Text style={styles.title}>Xiaomi Smart Band</Text>
        <Text style={styles.hint}>
          Speed, duty cycle and board battery through Mi Fitness. Install the Vescape band app
          first. Keep Mi Fitness connected in the background.
        </Text>
        <Input
          accessibilityLabel="Mi Fitness device ID"
          placeholder="Mi Fitness device ID"
          value={deviceId}
          onChangeText={setDeviceId}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={styles.hint}>
          {status.received
            ? 'Band is receiving Vescape data'
            : status.compatibility && status.sent
              ? 'Sending through Mi Fitness — one-way mode'
              : status.awake
                ? 'Band connected'
                : status.phase === 'connected'
                  ? 'Ready — open Vescape on the band'
                  : status.phase === 'connecting'
                    ? 'Connecting through Mi Fitness…'
                    : 'Connect your paired band'}
        </Text>
        {(error || status.error) && <Text style={styles.error}>{error || status.error}</Text>}
        {status.compatibility && (
          <Text style={styles.hint}>
            This Global band cannot send replies through Mi Fitness. Vescape sends readings directly
            while its board service runs.
          </Text>
        )}
        <Button
          label={status.phase === 'connecting' ? 'Connecting…' : 'Connect band'}
          onPress={connect}
          disabled={!deviceId.trim() || status.phase === 'connecting'}
        />
        {status.phase === 'connected' && <Button label="Open on band" onPress={openXiaomiBand} />}
        {status.nodeId && (
          <Button
            label="Disconnect band"
            variant="secondary"
            onPress={() => {
              configureXiaomiBand(null)
              setError(null)
            }}
          />
        )}
        <Text style={styles.hint}>
          Blue scale: 0–60 km/h. Yellow scale: 0–100% duty. Up to 5 updates per second; old readings
          clear automatically.
        </Text>
      </View>
    </SettingsCard>
  )
}
const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  title: { fontSize: 17, fontWeight: '700', color: theme.neutral.textPrimary },
  hint: { fontSize: 13, color: theme.neutral.textMuted },
  error: { fontSize: 13, color: theme.palette.red.color },
})

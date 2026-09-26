import { View } from 'react-native'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'

export function AccountUnavailableScreen() {
  return (
    <View style={{ flex: 1, padding: 24, gap: 12, backgroundColor: theme.neutral.bg }}>
      <Text style={{ fontSize: 20, fontWeight: '700' }}>Vescape account unavailable</Text>
      <Text>
        This development build supports local riding without a Vescape account. Cloud account
        services are not configured. You can connect your Floaty account separately in Settings.
      </Text>
    </View>
  )
}

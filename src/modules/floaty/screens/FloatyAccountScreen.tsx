import { SectionHeader } from '@/components/base/SectionHeader'
import { SettingsSectionTitle } from '@/components/settings/SettingsSectionTitle'
import { theme } from '@/constants/theme'
import { useEffect, useState } from 'react'
import { router } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { routes } from '@/navigation/routes'
import { ScrollView, View } from 'react-native'
import {
  CloudArrowUpIcon,
  SignOutIcon,
  ShieldCheckIcon,
  UserCircleIcon,
} from 'phosphor-react-native'
import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { Input } from '@/components/forms/Input'
import { Switch } from '@/components/controls/Switch'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { ConfirmModal } from '@/components/modals/ConfirmModal'
import {
  disconnectFloaty,
  initializeFloaty,
  floatyClient,
  reportFloatyError,
  setFloatyPreferences,
  signInFloaty,
  useFloatyStore,
} from '@/modules/floaty/store/floatyStore'
import { floatyStyles as s } from '../components/styles'

export default function FloatyAccountScreen() {
  const serviceError = useFloatyStore((state) => state.error)
  useEffect(() => {
    void initializeFloaty().catch(reportFloatyError)
  }, [])
  const identity = useFloatyStore((state) => state.identity)
  const busy = useFloatyStore((state) => state.busy)
  const ready = useFloatyStore((state) => state.ready)
  const auto = useFloatyStore((state) => state.preferences.autoUpload)
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState('')
  const [notice, setNotice] = useState(''),
    [resetting, setResetting] = useState(false)
  const [confirmAuto, setConfirmAuto] = useState(false),
    [confirmDisconnect, setConfirmDisconnect] = useState(false)
  async function connect() {
    try {
      await signInFloaty(email, password)
      setPassword('')
      setNotice(
        'Connected. Tiles and community rides are available on your map. Open a ride in History to upload it.',
      )
    } catch (error) {
      setPassword('')
      reportFloatyError(error)
    }
  }
  return (
    <SafeAreaView style={s.root} edges={['bottom']}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
        {serviceError ? (
          <View style={s.section}>
            <Text accessibilityLiveRegion="polite" style={s.error}>
              {serviceError}
            </Text>
            <Button
              label={ready ? 'Dismiss' : 'Retry loading'}
              size="sm"
              variant="secondary"
              onPress={() => {
                useFloatyStore.setState({ error: null })
                if (!ready) void initializeFloaty().catch(reportFloatyError)
              }}
            />
          </View>
        ) : null}
        <SectionHeader
          icon={UserCircleIcon}
          title="Floaty account"
          color={theme.palette.cyan.color}
          description={
            identity ? 'Connected to Floaty' : 'Connect to share recordings and browse rides.'
          }
        />
        {identity ? (
          <>
            <View style={s.section}>
              <Text style={s.label}>{identity.email}</Text>
              <Text style={s.muted}>
                Tiles and community rides are on the main map. Share recordings from Ride history.
              </Text>
              <Button
                label="Disconnect Floaty"
                icon={SignOutIcon}
                variant="secondary"
                loading={busy}
                onPress={() => setConfirmDisconnect(true)}
              />
            </View>
            <Button
              label="Back to map"
              variant="secondary"
              onPress={() => router.dismissTo(routes.home)}
            />
            <SettingsCard>
              <SettingsRow
                icon={CloudArrowUpIcon}
                label="Automatic uploads"
                hint="Rides started after enabling. Uploads resume when you reopen Vescape."
                right={
                  <Switch
                    value={auto}
                    onValueChange={(value) => {
                      if (value) setConfirmAuto(true)
                      else {
                        try {
                          setFloatyPreferences({ autoUpload: false })
                        } catch (error) {
                          reportFloatyError(error)
                        }
                      }
                    }}
                  />
                }
              />
              <SettingsRow
                icon={ShieldCheckIcon}
                label="Your recordings stay yours"
                hint="Disconnecting stops new uploads. Local recordings and rides already on Floaty are kept."
              />
            </SettingsCard>
          </>
        ) : (
          <View style={s.card}>
            <Text style={s.muted}>Sign in with your Floaty email and password.</Text>
            <Input
              accessibilityLabel="Floaty email"
              placeholder="Email address"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
            />
            <Input
              accessibilityLabel="Floaty password"
              placeholder="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="current-password"
              textContentType="password"
            />
            <Button
              label="Connect Floaty"
              testID="floaty-connect"
              loading={busy}
              disabled={!ready || !email.trim() || !password}
              onPress={() => void connect()}
            />
            <Button
              label="Reset Floaty password"
              variant="secondary"
              loading={resetting}
              disabled={!email.trim()}
              onPress={() => {
                setResetting(true)
                void floatyClient
                  .resetPassword(email)
                  .then(() =>
                    setNotice(
                      'If this email has a Floaty account, a password reset link has been sent.',
                    ),
                  )
                  .catch(reportFloatyError)
                  .finally(() => setResetting(false))
              }}
            />
            <Text style={s.muted}>
              Your password is never saved. Google-only account? Set a password through Floaty
              first.
            </Text>
          </View>
        )}
        {notice ? (
          <Text accessibilityLiveRegion="polite" style={s.success}>
            {notice}
          </Text>
        ) : null}
        <View style={s.section}>
          <SettingsSectionTitle>Sharing & privacy</SettingsSectionTitle>
          <Text style={s.muted}>
            Floaty processes tile ownership and achievements after upload.
          </Text>
          <Text style={s.muted}>
            Enabled Vescape privacy zones are removed from uploaded routes. Sharing follows your
            Floaty account’s visibility settings.
          </Text>
        </View>
        <ConfirmModal
          visible={confirmAuto}
          title="Automatically share new rides?"
          message="Future completed rides will be uploaded to your connected Floaty account, including their route and ride summary. Vescape privacy zones are hidden. Existing rides are not uploaded automatically."
          confirmLabel="Enable automatic uploads"
          onCancel={() => setConfirmAuto(false)}
          onConfirm={() => {
            setConfirmAuto(false)
            try {
              setFloatyPreferences({ autoUpload: true })
            } catch (error) {
              reportFloatyError(error)
            }
          }}
        />
        <ConfirmModal
          visible={confirmDisconnect}
          title="Disconnect Floaty?"
          message="Queued uploads will pause. Your local recordings and rides already uploaded to Floaty will remain."
          confirmLabel="Disconnect"
          onCancel={() => setConfirmDisconnect(false)}
          onConfirm={() => {
            setConfirmDisconnect(false)
            void disconnectFloaty().catch(reportFloatyError)
          }}
        />
      </ScrollView>
    </SafeAreaView>
  )
}

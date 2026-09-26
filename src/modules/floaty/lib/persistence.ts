import { File, Paths } from 'expo-file-system'
import * as SecureStore from 'expo-secure-store'
import type { TokenVault } from './client'
import {
  DEFAULT_FLOATY_PREFERENCES,
  type FloatyIdentity,
  type FloatyPreferences,
  type FloatyUpload,
} from './types'

const AUTH_KEY = 'vescape.floaty.identity.v1'
export const tokenVault: TokenVault = {
  async read() {
    const raw = await SecureStore.getItemAsync(AUTH_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as FloatyIdentity
    if (
      typeof value.uid !== 'string' ||
      typeof value.email !== 'string' ||
      typeof value.refreshToken !== 'string'
    )
      throw new Error('Stored Floaty account is unreadable. Reconnect your account.')
    return value
  },
  async write(identity) {
    if (identity)
      await SecureStore.setItemAsync(AUTH_KEY, JSON.stringify(identity), {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      })
    else await SecureStore.deleteItemAsync(AUTH_KEY)
  },
}
interface Snapshot {
  version: 1
  revision: number
  jobs: FloatyUpload[]
  preferences: FloatyPreferences
}
let revision = 0
function file(slot: number) {
  return new File(Paths.document, `floaty-state-${slot}.json`)
}
/** Two alternating snapshots: an interrupted write cannot destroy the last valid checkpoint. */
export function readSnapshot(): Snapshot {
  const valid: Snapshot[] = []
  let found = false
  for (const slot of [0, 1]) {
    const source = file(slot)
    if (!source.exists) continue
    found = true
    try {
      const state = JSON.parse(source.textSync()) as Snapshot
      if (
        state.version === 1 &&
        Number.isSafeInteger(state.revision) &&
        Array.isArray(state.jobs) &&
        state.preferences
      )
        valid.push(state)
    } catch {
      /* The other journal slot remains the recovery source after an interrupted write. */
    }
  }
  const latest = valid.sort((a, b) => b.revision - a.revision)[0]
  if (found && !latest)
    throw new Error(
      'Floaty upload history could not be read. Uploading is paused to prevent duplicates.',
    )
  revision = latest?.revision ?? 0
  return (
    latest ?? { version: 1, revision: 0, jobs: [], preferences: { ...DEFAULT_FLOATY_PREFERENCES } }
  )
}
export function saveSnapshot(jobs: FloatyUpload[], preferences: FloatyPreferences) {
  const next = revision + 1
  file(next % 2).write(JSON.stringify({ version: 1, revision: next, jobs, preferences }))
  revision = next
}

import { create } from 'zustand'
import { useTerritoryMapStore } from './territoryMapStore'
import { File } from 'expo-file-system'
import { exportRideGpx, getPrivacyZones, getLiveState } from 'vescape-core'
import { FloatyClient } from '../lib/client'
import { coordinatesFromGpx, makeSession, uploadId as uploadIdForSource } from '../lib/route'
import { readSnapshot, saveSnapshot, tokenVault } from '../lib/persistence'
import { isRideStillRecording } from '../lib/uploadReadiness'
import { UploadQueue } from '../lib/uploadQueue'
import {
  DEFAULT_FLOATY_PREFERENCES,
  type FloatyPreferences,
  type FloatyRide,
  type FloatyUpload,
  type UploadSource,
} from '../lib/types'

export const floatyClient = new FloatyClient(tokenVault)
interface FloatyState {
  ready: boolean
  identity: { uid: string; email: string } | null
  preferences: FloatyPreferences
  jobs: FloatyUpload[]
  selectedRide: FloatyRide | null
  error: string | null
  busy: boolean
}
export const useFloatyStore = create<FloatyState>(() => ({
  ready: false,
  identity: null,
  preferences: { ...DEFAULT_FLOATY_PREFERENCES },
  jobs: [],
  selectedRide: null,
  error: null,
  busy: false,
}))
let queue: UploadQueue | null = null
let initializing: Promise<void> | null = null
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Floaty is unavailable. Please retry.'
export function reportFloatyError(error: unknown) {
  useFloatyStore.setState({ error: message(error) })
}
export async function initializeFloaty() {
  if (useFloatyStore.getState().ready) return
  if (initializing) return initializing
  initializing = (async () => {
    const snapshot = readSnapshot()
    const identity = await floatyClient.restore()
    queue = new UploadQueue(snapshot.jobs, {
      save(jobs) {
        saveSnapshot(jobs, useFloatyStore.getState().preferences)
        useFloatyStore.setState({ jobs })
      },
      now: Date.now,
      currentUid: () => floatyClient.identity?.uid ?? null,
      async upload(job) {
        if (floatyClient.identity?.uid !== job.uid)
          throw new Error('Reconnect the account that queued this ride.')
        const session = await prepareFloatySession(job.source)
        if (job.reupload) await floatyClient.reupload(job.uid, session, job.remoteRange)
        else await floatyClient.upload(job.uid, session)
      },
    })
    useFloatyStore.setState({
      preferences: { ...DEFAULT_FLOATY_PREFERENCES, ...snapshot.preferences },
      jobs: queue.jobs,
      identity: identity ? { uid: identity.uid, email: identity.email } : null,
      ready: true,
      error: null,
    })
  })().finally(() => {
    initializing = null
  })
  return initializing
}
export function assertCompletedRide(source: UploadSource) {
  const recording = getLiveState().recording
  if (isRideStillRecording(source, recording)) {
    throw new Error('This ride is still recording. End the ride before uploading it.')
  }
  if (recording.failure)
    throw new Error('Recording storage needs attention before rides can be uploaded.')
}
export async function signInFloaty(email: string, password: string) {
  await initializeFloaty()
  useFloatyStore.setState({ busy: true, error: null })
  try {
    const identity = await floatyClient.signIn(email, password)
    useTerritoryMapStore.setState({ selected: null })
    if (useFloatyStore.getState().preferences.autoUploadUid !== identity.uid) {
      setFloatyPreferences({ autoUpload: false, autoUploadUid: null })
    }
    useFloatyStore.setState({
      identity: { uid: identity.uid, email: identity.email },
      selectedRide: null,
    })
  } finally {
    useFloatyStore.setState({ busy: false })
  }
}
export async function disconnectFloaty() {
  useFloatyStore.setState({ busy: true })
  try {
    useTerritoryMapStore.setState({ selected: null })
    useFloatyStore.setState({ identity: null, selectedRide: null })
    await floatyClient.signOut()
    setFloatyPreferences({ autoUpload: false, autoUploadUid: null })
    useFloatyStore.setState({ identity: null, selectedRide: null, error: null })
  } finally {
    useFloatyStore.setState({ busy: false })
  }
}
export function setFloatyPreferences(patch: Partial<FloatyPreferences>) {
  const state = useFloatyStore.getState()
  if (!state.ready) throw new Error('Floaty is still loading. Please try again.')
  const preferences = { ...state.preferences, ...patch }
  if (patch.autoUpload === true) {
    if (!state.identity) throw new Error('Connect Floaty before enabling automatic uploads.')
    preferences.autoUploadUid = state.identity.uid
    preferences.autoUploadSince = Date.now()
  }
  saveSnapshot(state.jobs, preferences)
  useFloatyStore.setState({ preferences })
}
export async function enqueueFloatyRide(
  source: UploadSource,
  expectedUid = useFloatyStore.getState().identity?.uid,
) {
  await initializeFloaty()
  const uid = useFloatyStore.getState().identity?.uid
  if (uid !== expectedUid) throw new Error('Floaty account changed. Please try again.')
  if (!uid || !queue) throw new Error('Connect your Floaty account first.')
  assertCompletedRide(source)
  queue.enqueue(uid, source)
  void processFloatyQueue().catch(reportFloatyError)
}
export async function processFloatyQueue() {
  await initializeFloaty()
  await queue?.process()
}
export function retryFloatyUpload(id: string) {
  const uid = useFloatyStore.getState().identity?.uid
  if (!uid) return
  queue?.retry(uid, id)
  void processFloatyQueue().catch(reportFloatyError)
}
export function cancelFloatyUpload(id: string) {
  const uid = useFloatyStore.getState().identity?.uid
  if (uid) queue?.cancel(uid, id)
}

export async function reuploadFloatyRide(
  source: UploadSource,
  expectedUid = useFloatyStore.getState().identity?.uid,
) {
  await initializeFloaty()
  const uid = useFloatyStore.getState().identity?.uid
  if (uid !== expectedUid) throw new Error('Floaty account changed. Please try again.')
  if (!uid || !queue) throw new Error('Connect your Floaty account first.')
  assertCompletedRide(source)
  queue.reupload(uid, uploadIdForSource(source), source)
  void processFloatyQueue().catch(reportFloatyError)
}

/** The same native export/privacy transformation is used for preview and actual upload. */
async function prepareFloatySession(source: UploadSource) {
  assertCompletedRide(source)
  const exported = await exportRideGpx({
    fromMs: source.startAtMs,
    toMs: source.endAtMs,
    boardId: source.boardId ?? undefined,
    recordingId: source.recordingId ?? undefined,
  })
  const file = new File(exported.uri)
  try {
    const points = coordinatesFromGpx(await file.text())
    const zones = await getPrivacyZones()
    const session = makeSession(
      source,
      points,
      zones,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    )
    assertCompletedRide(source)
    return session
  } finally {
    try {
      if (file.exists) file.delete()
    } catch (error) {
      // Cleanup failure must not turn a successful remote upload into a failed upload.
      reportFloatyError(new Error(`Could not remove the temporary ride export: ${message(error)}`))
    }
  }
}

export async function compareFloatyReupload(source: UploadSource, expectedUid: string) {
  await initializeFloaty()
  const assertAccount = () => {
    if (
      useFloatyStore.getState().identity?.uid !== expectedUid ||
      floatyClient.identity?.uid !== expectedUid
    )
      throw new Error('Floaty account changed. Please try again.')
  }
  assertAccount()
  const job = useFloatyStore
    .getState()
    .jobs.find((item) => item.uid === expectedUid && item.id === uploadIdForSource(source))
  if (!job) throw new Error('This recording has no saved Floaty upload.')
  const session = await prepareFloatySession(job.status === 'cancelled' ? job.source : source)
  assertAccount()
  const comparison = await floatyClient.compareReupload(
    expectedUid,
    session,
    job.status === 'uploaded' ? job.source : (job.remoteRange ?? job.source),
  )
  assertAccount()
  return comparison
}

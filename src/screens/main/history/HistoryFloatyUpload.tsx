import type { FloatyClubStatus } from '@/modules/floaty/lib/client'
import type { FloatyUpload } from '@/modules/floaty/lib/types'
import { useEffect, useRef, useState } from 'react'
import { AppState, StyleSheet, View } from 'react-native'
import { addLiveStateListener, getLiveState } from 'vescape-core'
import { CloudArrowUpIcon, ArrowClockwiseIcon } from 'phosphor-react-native'
import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { errorMessage } from '@/helpers/error'
import { uploadId } from '@/modules/floaty/lib/route'
import { isRideStillRecording } from '@/modules/floaty/lib/uploadReadiness'
import {
  cancelFloatyUpload,
  compareFloatyReupload,
  floatyClient,
  retryFloatyUpload,
  useFloatyStore,
} from '@/modules/floaty/store/floatyStore'
import type { HistorySession } from '@/modules/history/store/historyStore'
import { useHistoryFloatyStatus } from './useHistoryFloatyStatus'

export interface HistoryFloatyConfirmation {
  source: HistorySession
  uid: string
  reupload: boolean
  retry: boolean
  comparison?: string
}

/** Floaty is an optional action on the local ride, not a separate ride library. */
export function HistoryFloatyUpload({
  session,
  onConfirm,
}: {
  session: HistorySession
  onConfirm: (confirmation: HistoryFloatyConfirmation) => void
}) {
  const identity = useFloatyStore((state) => state.identity)
  const jobs = useFloatyStore((state) => state.jobs)
  const statusForSession = useHistoryFloatyStatus()
  const recording = useRecordingState()
  const club = useClubStatus(identity?.uid)
  const [error, setError] = useState<string | null>(null)
  const sourceKey = JSON.stringify([
    identity?.uid,
    session.startAtMs,
    session.endAtMs,
    session.boardId,
  ])
  const [checkingSource, setCheckingSource] = useState<string | null>(null)
  const checking = checkingSource === sourceKey
  const lifecycle = useRef({ cancelled: false })
  const comparisonRequest = useRef(0)
  useEffect(() => {
    const current = { cancelled: false }
    lifecycle.current = current
    // A cancelled comparison must not leave this ride's action busy when returning to it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCheckingSource(null)
    return () => {
      current.cancelled = true
    }
  }, [sourceKey])
  if (!identity) return null
  const job = jobs.find((item) => item.uid === identity.uid && item.id === uploadId(session))
  const active = isRideStillRecording(session, recording)
  const blocked = active || !!recording.failure || session.preciseGpsPointCount < 2
  const working = job?.status === 'queued' || job?.status === 'uploading'
  const failed = job?.status === 'failed'
  const waitingRetry = failed && job.nextAttemptAt < Number.MAX_SAFE_INTEGER
  const reupload = isReupload(job)
  const actionAppearance = reupload
    ? {
        accent: theme.palette.red.color,
        size: 'sm' as const,
        style: styles.superUpload,
        testID: 'history-floaty-super-upload',
      }
    : { size: 'md' as const, testID: 'history-floaty-upload' }
  const perform = (action: () => void) => {
    setError(null)
    try {
      action()
    } catch (cause) {
      setError(errorMessage(cause, 'Could not update this upload.'))
    }
  }
  return (
    <View style={styles.section}>
      <Text style={styles.title}>Floaty</Text>
      <Text style={styles.caption} accessibilityLiveRegion="polite">
        {clubStatusMessage(club)}
      </Text>
      {statusForSession(session) ? (
        <Text accessibilityLiveRegion="polite" style={styles.caption}>
          {statusForSession(session)}
        </Text>
      ) : null}
      {waitingRetry ? (
        <Text style={styles.caption}>
          Automatic retry while Vescape is open, after{' '}
          {new Date(job.nextAttemptAt).toLocaleTimeString()}.
        </Text>
      ) : null}
      {job?.error ? <Text style={styles.error}>{job.error}</Text> : null}
      {error ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <RecordingReadiness
        active={active}
        recording={recording}
        pointCount={session.preciseGpsPointCount}
      />
      <Button
        label={checking ? 'Checking saved ride…' : uploadActionLabel(job)}
        icon={failed ? ArrowClockwiseIcon : CloudArrowUpIcon}
        variant="secondary"
        {...actionAppearance}
        disabled={blocked || working || checking}
        loading={job?.status === 'uploading' || checking}
        onPress={() => {
          if (failed && job) {
            perform(() => retryFloatyUpload(job.id))
            return
          }
          const confirmation = {
            source: session,
            uid: identity.uid,
            reupload,
            retry: job?.status === 'cancelled',
          }
          if (!reupload) {
            onConfirm(confirmation)
            return
          }
          const request = ++comparisonRequest.current
          const current = lifecycle.current
          setCheckingSource(sourceKey)
          setError(null)
          void compareFloatyReupload(session, identity.uid)
            .then((result) => {
              if (current.cancelled || request !== comparisonRequest.current) return
              const names = {
                startTime: 'start time',
                endTime: 'end time',
                distance: 'distance',
                topSpeed: 'top speed',
                timezone: 'time zone',
                polyline: 'route',
                publicPolyline: 'public route',
              }
              const comparison =
                result.kind === 'unchanged'
                  ? 'No payload changes: Floaty already has the same route, summary and original ride times. Sending it again does not force tile processing.'
                  : result.kind === 'missing'
                    ? 'This ride is missing from Floaty. Super upload will recreate it using the same ID and original ride times.'
                    : `The local export differs in: ${result.changedFields.map((field) => names[field]).join(', ')}. Only these differences and the existing summary fields will be sent to the same ride.`
              onConfirm({ ...confirmation, comparison })
            })
            .catch((cause: unknown) => {
              if (!current.cancelled && request === comparisonRequest.current)
                setError(errorMessage(cause, 'Could not compare the saved ride. Please retry.'))
            })
            .finally(() => {
              if (!current.cancelled && request === comparisonRequest.current)
                setCheckingSource(null)
            })
        }}
      />
      {job && (job.status === 'queued' || failed) ? (
        <Button
          label="Cancel upload"
          variant="secondary"
          size="sm"
          onPress={() => perform(() => cancelFloatyUpload(job.id))}
        />
      ) : null}
      <Text style={styles.caption}>
        {reupload
          ? 'Super upload sends this ride’s recorded route and summary again with your current privacy zones and original ride times. It updates the same ride; identical data does not force tile processing. Floaty controls territory credit.'
          : 'Uploads resume while Vescape is open. Floaty decides tile credit after receiving the ride.'}
      </Text>
    </View>
  )
}

function RecordingReadiness({
  active,
  recording,
  pointCount,
}: {
  active: boolean
  recording: ReturnType<typeof getLiveState>['recording']
  pointCount: number
}) {
  return (
    <>
      {active ? (
        <Text style={styles.caption}>
          {recording.paused
            ? 'Paused is still recording. End the ride on the main screen before sharing.'
            : 'End the ride on the main screen before sharing.'}
        </Text>
      ) : null}
      {recording.failure ? (
        <Text style={styles.error}>Recording storage needs attention before uploading.</Text>
      ) : null}
      {pointCount < 2 ? <Text style={styles.caption}>No recorded GPS route to share.</Text> : null}
    </>
  )
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  superUpload: { alignSelf: 'flex-start' },
  title: { color: theme.neutral.textPrimary, fontSize: 13, fontWeight: '600' },
  caption: { color: theme.neutral.textSecondary, fontSize: 12, lineHeight: 17 },
  error: { color: theme.status.error.text, fontSize: 12, lineHeight: 17 },
})

function useClubStatus(uid: string | undefined): FloatyClubStatus | null {
  const [result, setResult] = useState<{ uid: string; status: FloatyClubStatus } | null>(null)
  useEffect(() => {
    if (!uid) return
    let cancelled = false
    const publish = (status: FloatyClubStatus) => {
      if (!cancelled && useFloatyStore.getState().identity?.uid === uid) setResult({ uid, status })
    }
    void floatyClient.ownClubStatus().then(publish, () => publish({ kind: 'unknown' }))
    return () => {
      cancelled = true
    }
  }, [uid])
  return result && result.uid === uid ? result.status : null
}

function useRecordingState() {
  const [recording, setRecording] = useState(() => getLiveState().recording)
  useEffect(() => {
    const update = (next: typeof recording) =>
      setRecording((previous) =>
        previous.enabled === next.enabled &&
        previous.paused === next.paused &&
        previous.recordingId === next.recordingId &&
        previous.startedAt === next.startedAt &&
        previous.activeBoardId === next.activeBoardId &&
        previous.failure === next.failure
          ? previous
          : next,
      )
    const live = addLiveStateListener((state) => update(state.recording))
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') update(getLiveState().recording)
    })
    return () => {
      live.remove()
      app.remove()
    }
  }, [])
  return recording
}

function uploadActionLabel(job: FloatyUpload | undefined): string {
  if (!job) return 'Upload to Floaty'
  switch (job.status) {
    case 'uploading':
      return job.reupload ? 'Reuploading…' : 'Uploading…'
    case 'queued':
      return job.reupload ? 'Reupload queued' : 'Queued for upload'
    case 'failed':
      return job.nextAttemptAt < Number.MAX_SAFE_INTEGER ? 'Retry now' : 'Retry Floaty upload'
    case 'uploaded':
      return 'Super upload'
    case 'cancelled':
      return job.reupload ? 'Resume reupload' : 'Upload to Floaty'
  }
}

function isReupload(job: FloatyUpload | undefined): boolean {
  return job?.status === 'uploaded' || job?.reupload === true
}

function clubStatusMessage(club: FloatyClubStatus | null) {
  return club == null
    ? 'Checking club membership…'
    : club.kind === 'member'
      ? club.name
        ? `Club membership: ${club.name}. Floaty decides territory credit.`
        : 'Club membership confirmed. Floaty decides territory credit.'
      : club.kind === 'pending'
        ? 'Club request pending. You are not a member yet; check Floaty for approval.'
        : club.kind === 'none'
          ? 'Join a club in Floaty to claim club territory.'
          : 'Club membership could not be checked. You can still upload this ride.'
}

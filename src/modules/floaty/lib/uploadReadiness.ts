import type { LiveStateEvent } from 'vescape-core'
import type { UploadSource } from './types'

/** Native recording identity wins over timestamps, including while idle-paused or disconnected. */
export function isRideStillRecording(
  source: UploadSource,
  recording: LiveStateEvent['recording'],
): boolean {
  if (!recording.enabled) return false
  if (source.recordingId && recording.recordingId)
    return source.recordingId === recording.recordingId
  if (recording.activeBoardId !== source.boardId) return false
  // Older native builds did not expose the recording start. Fail closed for this board.
  return recording.startedAt == null || recording.startedAt <= source.endAtMs
}

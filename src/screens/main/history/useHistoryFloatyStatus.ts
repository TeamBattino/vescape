import { useCallback } from 'react'
import { uploadId } from '@/modules/floaty/lib/route'
import { useFloatyStore } from '@/modules/floaty/store/floatyStore'
import type { UploadSource } from '@/modules/floaty/lib/types'

/** Composition-only labels: the History module does not depend on the connected service. */
export function useHistoryFloatyStatus() {
  const uid = useFloatyStore((state) => state.identity?.uid)
  const jobs = useFloatyStore((state) => state.jobs)
  return useCallback(
    (source: UploadSource): string | undefined => {
      if (!uid) return undefined
      const job = jobs.find((item) => item.uid === uid && item.id === uploadId(source))
      if (!job) return undefined
      switch (job.status) {
        case 'uploaded':
          return job.reupload ? 'Reuploaded to Floaty' : 'Saved to Floaty'
        case 'uploading':
          return job.reupload ? 'Reuploading to Floaty…' : 'Uploading to Floaty…'
        case 'queued':
          return job.reupload ? 'Floaty reupload queued' : 'Floaty upload queued'
        case 'failed':
          return job.nextAttemptAt < Number.MAX_SAFE_INTEGER
            ? 'Floaty waiting to retry'
            : 'Floaty upload needs attention'
        case 'cancelled':
          return job.reupload ? 'Floaty reupload cancelled' : 'Floaty upload cancelled'
      }
    },
    [uid, jobs],
  )
}

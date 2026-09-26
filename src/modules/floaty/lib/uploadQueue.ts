import { FloatyError } from './client'
import { uploadId } from './route'
import type { FloatyUpload, UploadSource } from './types'
export interface UploadQueuePorts {
  save(jobs: FloatyUpload[]): void
  upload(job: FloatyUpload): Promise<void>
  currentUid(): string | null
  now(): number
}
/** Durable work is checkpointed before network I/O. The native recording is never changed. */
export class UploadQueue {
  jobs: FloatyUpload[]
  private running: Promise<void> | null = null
  constructor(
    jobs: FloatyUpload[],
    private ports: UploadQueuePorts,
  ) {
    this.jobs = jobs.map((job) => {
      // Older installed builds persisted the same full-session rewrite under this flag.
      // Preserve interrupted intent without keeping the old name in future checkpoints.
      const { resubmit, ...current } = job as FloatyUpload & { resubmit?: boolean }
      return {
        ...current,
        reupload: current.reupload ?? resubmit,
        status: current.status === 'uploading' ? 'queued' : current.status,
      }
    })
  }
  private commit(jobs: FloatyUpload[]) {
    this.ports.save(jobs)
    this.jobs = jobs
  }
  enqueue(uid: string, source: UploadSource) {
    const id = uploadId(source)
    const existing = this.jobs.find((job) => job.id === id && job.uid === uid)
    if (existing) return existing
    const job: FloatyUpload = { id, uid, source, status: 'queued', attempts: 0, nextAttemptAt: 0 }
    this.commit([...this.jobs, job])
    return job
  }
  retry(uid: string, id: string) {
    this.commit(
      this.jobs.map((job) =>
        job.id === id && job.uid === uid && (job.status === 'failed' || job.status === 'cancelled')
          ? { ...job, status: 'queued', attempts: 0, nextAttemptAt: 0, error: undefined }
          : job,
      ),
    )
  }
  reupload(uid: string, id: string, source: UploadSource) {
    const job = this.jobs.find((item) => item.uid === uid && item.id === id)
    if (!job || job.status !== 'uploaded')
      throw new Error('Only an uploaded ride can be reuploaded.')
    const nextSource = source
    if (uploadId(nextSource) !== id || nextSource.boardId !== job.source.boardId)
      throw new Error('Reupload must use the same recorded ride.')
    this.patch(job, {
      source: nextSource,
      remoteRange: { startAtMs: job.source.startAtMs, endAtMs: job.source.endAtMs },
      status: 'queued',
      reupload: true,
      attempts: 0,
      nextAttemptAt: 0,
      error: undefined,
    })
  }
  cancel(uid: string, id: string) {
    this.commit(
      this.jobs.map((job) =>
        job.id === id && job.uid === uid && (job.status === 'queued' || job.status === 'failed')
          ? { ...job, status: 'cancelled' }
          : job,
      ),
    )
  }
  private patch(job: FloatyUpload, patch: Partial<FloatyUpload>) {
    this.commit(
      this.jobs.map((item) =>
        item.uid === job.uid && item.id === job.id ? { ...item, ...patch } : item,
      ),
    )
  }
  process(): Promise<void> {
    if (this.running) return this.running
    this.running = this.drain().finally(() => {
      this.running = null
    })
    return this.running
  }
  private async drain() {
    for (const candidate of [...this.jobs]) {
      const job = this.jobs.find((item) => item.id === candidate.id && item.uid === candidate.uid)
      if (!job) continue
      if (this.ports.currentUid() !== job.uid) continue
      if (job.status !== 'queued' && job.status !== 'failed') continue
      if (job.nextAttemptAt > this.ports.now()) continue
      this.patch(job, { status: 'uploading', error: undefined })
      try {
        await this.ports.upload(job)
        this.patch(job, {
          status: 'uploaded',
          uploadedAt: this.ports.now(),
          error: undefined,
          remoteRange: undefined,
        })
      } catch (error) {
        const attempts = job.attempts + 1
        const retryable =
          error instanceof FloatyError &&
          (error.status === 0 || error.status === 429 || error.status >= 500)
        this.patch(job, {
          status: 'failed',
          attempts,
          nextAttemptAt:
            retryable && attempts < 6
              ? this.ports.now() + Math.min(30_000 * 2 ** (attempts - 1), 900_000)
              : Number.MAX_SAFE_INTEGER,
          error: error instanceof Error ? error.message : 'Upload failed. Please retry.',
        })
      }
    }
  }
}

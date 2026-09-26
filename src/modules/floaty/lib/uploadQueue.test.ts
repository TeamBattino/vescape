import { describe, expect, test } from 'bun:test'
import { FloatyError } from './client'
import { UploadQueue, type UploadQueuePorts } from './uploadQueue'
import type { FloatyUpload, UploadSource } from './types'
const source: UploadSource = {
  boardId: 'b',
  boardName: 'Board',
  recordingId: 'r',
  startAtMs: 1,
  endAtMs: 2,
  distanceM: 100,
  maxSpeedKmh: 10,
}
function harness(overrides: Partial<UploadQueuePorts> = {}, jobs: FloatyUpload[] = []) {
  let durable: FloatyUpload[] = jobs
  const uploads: string[] = []
  const queue = new UploadQueue(jobs, {
    save: (next) => {
      durable = structuredClone(next)
    },
    upload: async (job) => {
      uploads.push(job.id)
    },
    currentUid: () => 'me',
    now: () => 1000,
    ...overrides,
  })
  return { queue, durable: () => durable, uploads }
}
describe('durable Floaty uploads', () => {
  test('duplicate clicks enqueue and upload a recording once', async () => {
    const h = harness()
    h.queue.enqueue('me', source)
    h.queue.enqueue('me', source)
    await Promise.all([h.queue.process(), h.queue.process()])
    expect(h.uploads).toHaveLength(1)
    expect(h.durable()[0]!.status).toBe('uploaded')
  })
  test('an interrupted in-flight upload resumes after restart', async () => {
    const h = harness()
    h.queue.enqueue('me', source)
    const restored = harness(
      {},
      h.durable().map((job) => ({ ...job, status: 'uploading' })),
    )
    await restored.queue.process()
    expect(restored.uploads).toHaveLength(1)
  })
  test('network failures back off and remain retryable', async () => {
    const h = harness({
      upload: async () => {
        throw new FloatyError('Offline')
      },
    })
    h.queue.enqueue('me', source)
    await h.queue.process()
    expect(h.durable()[0]).toMatchObject({ status: 'failed', attempts: 1, nextAttemptAt: 31_000 })
    await h.queue.process()
    expect(h.durable()[0]!.attempts).toBe(1)
  })
  test('permission errors require explicit retry', async () => {
    const h = harness({
      upload: async () => {
        throw new FloatyError('Denied', 403)
      },
    })
    h.queue.enqueue('me', source)
    await h.queue.process()
    expect(h.durable()[0]!.nextAttemptAt).toBe(Number.MAX_SAFE_INTEGER)
    h.queue.retry('me', h.queue.jobs[0]!.id)
    expect(h.durable()[0]!.status).toBe('queued')
  })
  test('jobs are isolated by account', async () => {
    const h = harness()
    h.queue.enqueue('other', source)
    h.queue.enqueue('me', source)
    await h.queue.process()
    expect(h.uploads).toHaveLength(1)
    expect(h.queue.jobs[0]!.status).toBe('queued')
  })
  test('cancellation survives automatic rediscovery', async () => {
    const h = harness()
    const job = h.queue.enqueue('me', source)
    h.queue.cancel('me', job.id)
    h.queue.enqueue('me', source)
    await h.queue.process()
    expect(h.uploads).toHaveLength(0)
    expect(h.durable()[0]!.status).toBe('cancelled')
    h.queue.retry('me', job.id)
    await h.queue.process()
    expect(h.uploads).toHaveLength(1)
  })
  test('no upload occurs if the pre-network checkpoint cannot be persisted', async () => {
    const h = harness()
    h.queue.enqueue('me', source)
    const restored = harness(
      {
        save: () => {
          throw new Error('Disk full')
        },
      },
      h.durable(),
    )
    await expect(restored.queue.process()).rejects.toThrow('Disk full')
    expect(restored.uploads).toHaveLength(0)
  })
  test('an account change while draining pauses remaining jobs', async () => {
    let uid: string | null = 'me'
    const h = harness({
      currentUid: () => uid,
      upload: async () => {
        uid = null
      },
    })
    h.queue.enqueue('me', source)
    h.queue.enqueue('me', { ...source, recordingId: 'r2' })
    await h.queue.process()
    expect(h.queue.jobs.map((job) => job.status)).toEqual(['uploaded', 'queued'])
  })
})

test('cancelling another queued ride while one uploads prevents its upload', async () => {
  let release!: () => void
  const hold = new Promise<void>((resolve) => {
    release = resolve
  })
  let uploads = 0
  const h = harness({
    upload: async () => {
      uploads++
      await hold
    },
  })
  h.queue.enqueue('me', source)
  const second = h.queue.enqueue('me', { ...source, recordingId: 'second' })
  const processing = h.queue.process()
  h.queue.cancel('me', second.id)
  release()
  await processing
  expect(uploads).toBe(1)
  expect(h.durable()[1]!.status).toBe('cancelled')
})

test('explicit reupload preserves the same remote ID and survives restart', async () => {
  const h = harness()
  const job = h.queue.enqueue('me', source)
  await h.queue.process()
  h.queue.reupload('me', job.id, source)
  expect(h.durable()[0]).toMatchObject({ id: job.id, status: 'queued', reupload: true })
  expect(() => h.queue.reupload('me', job.id, source)).toThrow()
  const restored = harness({}, h.durable())
  await restored.queue.process()
  expect(restored.queue.jobs).toHaveLength(1)
  expect(restored.queue.jobs[0]).toMatchObject({ id: job.id, status: 'uploaded', reupload: true })
})
test('reupload cannot select a different account’s saved upload', async () => {
  const h = harness()
  const job = h.queue.enqueue('me', source)
  await h.queue.process()
  expect(() => h.queue.reupload('other', job.id, source)).toThrow()
  expect(h.durable()[0]!.status).toBe('uploaded')
})

test('reupload checkpoints the complete source and its old remote range', async () => {
  const h = harness()
  const job = h.queue.enqueue('me', source)
  await h.queue.process()
  const complete = { ...source, endAtMs: 500, distanceM: 200 }
  h.queue.reupload('me', job.id, complete)
  expect(h.durable()[0]).toMatchObject({
    source: complete,
    remoteRange: { startAtMs: 1, endAtMs: 2 },
  })
  await h.queue.process()
  expect(h.durable()[0]!.remoteRange).toBeUndefined()
  expect(h.durable()[0]!.source.endAtMs).toBe(500)
})

test('upgrading an interrupted old resubmit checkpoint preserves full reupload intent', async () => {
  const legacy = {
    id: 'vescape-r',
    uid: 'me',
    source,
    status: 'uploading' as const,
    attempts: 2,
    nextAttemptAt: 0,
    resubmit: true,
    remoteRange: { startAtMs: 1, endAtMs: 2 },
  }
  const sent: FloatyUpload[] = []
  const h = harness(
    {
      upload: async (job) => {
        sent.push(structuredClone(job))
      },
    },
    [legacy],
  )
  expect(h.queue.jobs[0]).toMatchObject({ status: 'queued', reupload: true })
  expect(h.queue.jobs[0]).not.toHaveProperty('resubmit')
  await h.queue.process()
  expect(sent[0]).toMatchObject({ reupload: true, source, remoteRange: legacy.remoteRange })
  expect(h.durable()[0]).toMatchObject({ status: 'uploaded', reupload: true })
})

test('a failed reupload keeps the fresh source and original remote range across retry', async () => {
  const h = harness()
  const job = h.queue.enqueue('me', source)
  await h.queue.process()
  const full = { ...source, endAtMs: 500, distanceM: 250, maxSpeedKmh: 25 }
  h.queue.reupload('me', job.id, full)
  const failed = harness(
    {
      upload: async () => {
        throw new FloatyError('Offline')
      },
    },
    h.durable(),
  )
  await failed.queue.process()
  failed.queue.retry('me', job.id)
  expect(failed.durable()[0]).toMatchObject({
    status: 'queued',
    reupload: true,
    source: full,
    remoteRange: { startAtMs: source.startAtMs, endAtMs: source.endAtMs },
  })
})

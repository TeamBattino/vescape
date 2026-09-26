import { describe, expect, test } from 'bun:test'
import { createRideBrowser, type RideBrowserState } from './rideBrowser'
import type { FloatyPage, FloatyRide, FloatyRider } from './types'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const ride = (id: string): FloatyRide => ({
  id,
  userId: 'me',
  name: id,
  startTime: 0,
  endTime: 10,
  distance: 1,
  topSpeed: 2,
  polyline: null,
})
function fixture(client: Parameters<typeof createRideBrowser>[0]['client']) {
  let uid = 'me'
  const frames: RideBrowserState[] = []
  const browser = createRideBrowser({
    uid,
    currentUid: () => uid,
    client,
    publish: (state) => frames.push(state),
  })
  return {
    browser,
    frames,
    latest: () => frames.at(-1)!,
    switchAccount: () => {
      uid = 'other'
    },
  }
}

describe('Floaty ride browser requests', () => {
  test('new username search supersedes a pending own-rides page and its error', async () => {
    const old = deferred<FloatyPage>()
    const f = fixture({
      sessions: (owner) =>
        owner === 'me' ? old.promise : Promise.resolve({ rides: [ride('new')] }),
      findRider: async (username) => ({ uid: 'them', username, displayName: 'Them' }),
    })
    const own = f.browser.own()
    await f.browser.search('  them  ')
    old.reject(new Error('obsolete failure'))
    await own
    expect(f.latest().rides.map((r) => r.id)).toEqual(['new'])
    expect(f.latest().query).toBe('them')
    expect(f.latest().error).toBeNull()
    expect(f.latest().loading).toBe(false)
  })

  test('slow rider lookup cannot replace a newer search or start its page request', async () => {
    const lookup = deferred<FloatyRider | null>()
    const owners: string[] = []
    const f = fixture({
      sessions: async (owner) => {
        owners.push(owner)
        return { rides: [ride(owner)] }
      },
      findRider: (username) =>
        username === 'slow'
          ? lookup.promise
          : Promise.resolve({ uid: username, username, displayName: username }),
    })
    const slow = f.browser.search('slow')
    await f.browser.search('fast')
    lookup.resolve({ uid: 'slow', username: 'slow', displayName: 'Slow' })
    await slow
    expect(owners).toEqual(['fast'])
    expect(f.latest().rider?.uid).toBe('fast')
  })

  test('account switch or disposal prevents late data and errors publishing', async () => {
    for (const stop of ['switch', 'dispose']) {
      const pending = deferred<FloatyPage>()
      const f = fixture({ sessions: () => pending.promise, findRider: async () => null })
      const task = f.browser.own()
      if (stop === 'switch') f.switchAccount()
      else f.browser.dispose()
      const count = f.frames.length
      pending.reject(new Error('old account'))
      await task
      await f.browser.refresh()
      expect(f.frames).toHaveLength(count)
    }
  })

  test('deduplicates within and across pages, serializes more requests, stops cursor cycles', async () => {
    const pending = deferred<FloatyPage>()
    const tokens: (string | undefined)[] = []
    const f = fixture({
      sessions: async (_, token) => {
        tokens.push(token)
        if (!token) return { rides: [ride('a'), ride('a')], nextPageToken: 'p1' }
        if (token === 'p1') return pending.promise
        return { rides: [ride('c')], nextPageToken: 'p1' }
      },
      findRider: async () => null,
    })
    await f.browser.own()
    const first = f.browser.loadMore()
    await f.browser.loadMore()
    pending.resolve({ rides: [ride('a'), ride('b'), ride('b')], nextPageToken: 'p2' })
    await first
    await f.browser.loadMore()
    await f.browser.loadMore()
    expect(f.latest().rides.map((r) => r.id)).toEqual(['a', 'b', 'c'])
    expect(tokens).toEqual([undefined, 'p1', 'p2'])
    expect(f.latest().next).toBeUndefined()
  })

  test('failed next page retains existing rows and can retry the same cursor', async () => {
    let fail = true
    const f = fixture({
      sessions: async (_, token) => {
        if (!token) return { rides: [ride('a')], nextPageToken: 'more' }
        if (fail) throw new Error('offline')
        return { rides: [ride('b')] }
      },
      findRider: async () => null,
    })
    await f.browser.own()
    await f.browser.loadMore()
    expect(f.latest().rides.map((r) => r.id)).toEqual(['a'])
    expect(f.latest().next).toBe('more')
    expect(f.latest().error).toBe('offline')
    fail = false
    await f.browser.loadMore()
    expect(f.latest().rides.map((r) => r.id)).toEqual(['a', 'b'])
    expect(f.latest().error).toBeNull()
  })

  test('no-match retry reruns exact username lookup rather than falling back to own rides', async () => {
    let lookups = 0
    let sessions = 0
    const f = fixture({
      sessions: async () => {
        sessions++
        return { rides: [] }
      },
      findRider: async () => {
        lookups++
        return null
      },
    })
    await f.browser.search('missing')
    await f.browser.refresh()
    expect(lookups).toBe(2)
    expect(sessions).toBe(0)
    expect(f.latest().query).toBe('missing')
    expect(f.latest().loading).toBe(false)
  })
})

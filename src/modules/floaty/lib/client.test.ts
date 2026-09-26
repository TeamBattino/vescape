import { describe, expect, test } from 'bun:test'
import { FloatyClient, type TokenVault, type FloatyClubStatus } from './client'
import type { FloatyIdentity, FloatySession } from './types'
import { encodeFields } from './firestore'
const identity: FloatyIdentity = { uid: 'me', email: 'me@example.com', refreshToken: 'refresh' }
const session: FloatySession = {
  id: 'vescape-1',
  startTime: 1000,
  endTime: 2000,
  timezone: 'UTC',
  polyline: '??AA',
  publicPolyline: '??AA',
  distance: 1,
  topSpeed: 20,
  groupRideId: null,
}
function harness(
  responses: { status?: number; body: unknown }[],
  stored: FloatyIdentity | null = identity,
) {
  const calls: { url: string; init: RequestInit }[] = []
  let current = stored
  const vault: TokenVault = {
    read: async () => current,
    write: async (value) => {
      current = value
    },
  }
  const transport = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const response = responses.shift()
    if (!response) throw new Error('Unexpected request')
    return new Response(JSON.stringify(response.body), { status: response.status ?? 200 })
  }) as typeof fetch
  return { client: new FloatyClient(vault, transport), calls, stored: () => current }
}
const refresh = {
  body: {
    id_token: 'id-token',
    refresh_token: 'rotated-refresh',
    user_id: 'me',
    expires_in: '3600',
  },
}
describe('Floaty transport', () => {
  test('refreshes the stored identity once and uses bearer authentication', async () => {
    const h = harness([refresh, { body: { documents: [] } }, { body: { documents: [] } }])
    await h.client.restore()
    await h.client.sessions('me')
    await h.client.sessions('me')
    expect(h.calls).toHaveLength(3)
    expect(h.calls[0]!.init.body).toBe('grant_type=refresh_token&refresh_token=refresh')
    expect(h.calls[1]!.init.headers).toMatchObject({ Authorization: 'Bearer id-token' })
    expect(h.stored()?.refreshToken).toBe('rotated-refresh')
  })
  test('does not store the password or id token', async () => {
    const h = harness(
      [
        {
          body: {
            localId: 'me',
            email: identity.email,
            refreshToken: 'new-refresh',
            idToken: 'short-lived',
            expiresIn: '3600',
          },
        },
      ],
      null,
    )
    await h.client.signIn(identity.email, 'do-not-store')
    expect(h.stored()).toEqual({ ...identity, refreshToken: 'new-refresh' })
  })
  test('wrong credentials give an actionable message without exposing response payloads', async () => {
    const h = harness(
      [{ status: 400, body: { error: { message: 'INVALID_LOGIN_CREDENTIALS' } } }],
      null,
    )
    await expect(h.client.signIn('a@b.c', 'bad')).rejects.toThrow('Email or password')
    expect(h.stored()).toBeNull()
  })
  test('signed-out uploads never contact Firestore', async () => {
    const h = harness([], null)
    await expect(h.client.upload('me', session)).rejects.toThrow('Account changed')
    expect(h.calls).toHaveLength(0)
  })
  test('queued rides cannot be uploaded to another account', async () => {
    const h = harness([])
    await h.client.restore()
    await expect(h.client.upload('someone-else', session)).rejects.toThrow('Account changed')
    expect(h.calls).toHaveLength(0)
  })
  test('other riders use public geometry, with no private-polyline fallback', async () => {
    const documents = [
      {
        name: 'users/other/sessions/1',
        fields: encodeFields({ startTime: 1, polyline: 'private', publicPolyline: 'public' }),
      },
      {
        name: 'users/other/sessions/2',
        fields: encodeFields({ startTime: 2, polyline: 'private', publicPolyline: null }),
      },
    ]
    const h = harness([refresh, { body: { documents, nextPageToken: 'next / page' } }])
    await h.client.restore()
    const page = await h.client.sessions('other')
    expect(page.rides.map((ride) => ride.polyline)).toEqual(['public', null])
    expect(page.nextPageToken).toBe('next / page')
  })
  test('permission failures do not turn into an empty successful result', async () => {
    const h = harness([refresh, { status: 403, body: { error: { message: 'PERMISSION_DENIED' } } }])
    await h.client.restore()
    await expect(h.client.sessions('private-user')).rejects.toThrow('does not allow access')
  })
  test('a lost upload response can be retried without overwriting the existing ride', async () => {
    const h = harness([
      refresh,
      { status: 409, body: { error: { message: 'ALREADY_EXISTS' } } },
      { body: { name: 'sessions/vescape-1', fields: encodeFields(session) } },
    ])
    await h.client.restore()
    await h.client.upload('me', session)
    expect(h.calls[1]!.url).toContain('currentDocument.exists=false')
    expect(h.calls[1]!.init.method).toBe('PATCH')
    expect(h.calls[2]!.init.method).toBeUndefined()
  })
  test('a conflicting remote ride is never overwritten', async () => {
    const h = harness([
      refresh,
      { status: 409, body: {} },
      {
        body: { name: 'sessions/vescape-1', fields: encodeFields({ ...session, startTime: 999 }) },
      },
    ])
    await h.client.restore()
    await expect(h.client.upload('me', session)).rejects.toThrow('Nothing was overwritten')
  })
  test('disconnect deletes credentials and blocks subsequent requests', async () => {
    const h = harness([])
    await h.client.restore()
    await h.client.signOut()
    expect(h.stored()).toBeNull()
    await expect(h.client.sessions('me')).rejects.toThrow('Account changed')
  })
  test('a refresh response for a different user is rejected', async () => {
    const h = harness([{ body: { ...refresh.body, user_id: 'other' } }])
    await h.client.restore()
    await expect(h.client.sessions('me')).rejects.toThrow('reconnect')
  })
})

test('reupload updates only route summary fields with a version precondition', async () => {
  const h = harness([
    refresh,
    {
      body: {
        fields: encodeFields({ ...session, name: 'My ride', tileCount: 5 }),
        updateTime: '2026-09-23T12:00:00Z',
      },
    },
    { body: {} },
  ])
  await h.client.restore()
  await h.client.reupload('me', session)
  const request = h.calls[2]!
  const url = new URL(request.url)
  expect(url.searchParams.get('currentDocument.updateTime')).toBe('2026-09-23T12:00:00Z')
  expect(url.searchParams.getAll('updateMask.fieldPaths').sort()).toEqual([
    'distance',
    'endTime',
    'polyline',
    'publicPolyline',
    'startTime',
    'timezone',
    'topSpeed',
  ])
  expect(request.init.method).toBe('PATCH')
  expect(JSON.parse(String(request.init.body)).fields.name).toBeUndefined()
  expect(JSON.parse(String(request.init.body)).fields.tileCount).toBeUndefined()
  expect(JSON.parse(String(request.init.body)).fields.groupRideId).toBeUndefined()
})
test('reupload refuses an identity collision without changing remote content', async () => {
  const h = harness([
    refresh,
    {
      body: {
        fields: encodeFields({ ...session, startTime: 9 }),
        updateTime: '2026-09-23T12:00:00Z',
      },
    },
  ])
  await h.client.restore()
  await expect(h.client.reupload('me', session)).rejects.toThrow('no longer matches')
  expect(h.calls).toHaveLength(2)
})
test('reupload surfaces concurrent edits instead of overwriting them', async () => {
  const h = harness([
    refresh,
    { body: { fields: encodeFields(session), updateTime: '2026-09-23T12:00:00Z' } },
    { status: 400, body: { error: { message: 'FAILED_PRECONDITION' } } },
  ])
  await h.client.restore()
  await expect(h.client.reupload('me', session)).rejects.toThrow()
  expect(h.calls).toHaveLength(3)
})

test('reuploading a formerly truncated ride extends its range using the known previous identity', async () => {
  const updated = { ...session, endTime: 4000, distance: 2 }
  const h = harness([
    refresh,
    { body: { fields: encodeFields(session), updateTime: '2026-09-23T12:00:00Z' } },
    { body: {} },
  ])
  await h.client.restore()
  await h.client.reupload('me', updated, { startAtMs: session.startTime, endAtMs: session.endTime })
  expect(JSON.parse(String(h.calls[2]!.init.body)).fields.endTime).toEqual({ integerValue: '4000' })
})

test('Super upload sends the full refreshed route and summary, never deletes or creates a duplicate', async () => {
  const fresh = {
    ...session,
    endTime: 8000,
    distance: 3.2,
    topSpeed: 28,
    timezone: 'Europe/Lisbon',
    polyline: 'new-private-zone-masked-route',
    publicPolyline: 'new-private-zone-masked-route',
  }
  const h = harness([
    refresh,
    {
      body: {
        fields: encodeFields({
          ...session,
          name: 'Keep my name',
          groupRideId: 'my-group',
          tileCount: 12,
        }),
        updateTime: '2026-09-24T12:00:00Z',
      },
    },
    { body: {} },
  ])
  await h.client.restore()
  await h.client.reupload('me', fresh, { startAtMs: session.startTime, endAtMs: session.endTime })
  const writes = h.calls.filter((call) => call.init.method === 'PATCH')
  expect(writes).toHaveLength(1)
  const write = writes[0]!
  expect(new URL(write.url).pathname).toEndWith('/users/me/sessions/vescape-1')
  expect(JSON.parse(String(write.init.body)).fields).toEqual(
    encodeFields({
      startTime: fresh.startTime,
      endTime: fresh.endTime,
      distance: fresh.distance,
      topSpeed: fresh.topSpeed,
      timezone: fresh.timezone,
      polyline: fresh.polyline,
      publicPolyline: fresh.publicPolyline,
    }),
  )
  expect(h.calls.some((call) => call.init.method === 'DELETE')).toBe(false)
})

test('reupload recreates a missing owned session using its same ID', async () => {
  const h = harness([refresh, { status: 404, body: {} }, { body: {} }])
  await h.client.restore()
  await h.client.reupload('me', session)
  const create = h.calls[2]!
  expect(create.url).toContain('/users/me/sessions/vescape-1?currentDocument.exists=false')
  expect(JSON.parse(String(create.init.body)).fields).toEqual(encodeFields(session))
})

describe('own Floaty club membership preflight', () => {
  test('uses stored clubId, reads the club name, and shares a cached request', async () => {
    const h = harness([
      refresh,
      { body: { fields: encodeFields({ clubId: 'club one', pendingClubId: 'other' }) } },
      { body: { fields: encodeFields({ name: 'River Riders' }) } },
    ])
    await h.client.restore()
    const results = await Promise.all([h.client.ownClubStatus(), h.client.ownClubStatus()])
    expect(results).toEqual([
      { kind: 'member', clubId: 'club one', name: 'River Riders' },
      { kind: 'member', clubId: 'club one', name: 'River Riders' },
    ])
    expect(await h.client.ownClubStatus()).toEqual(results[0])
    expect(h.calls).toHaveLength(3)
    expect(h.calls[1]!.url).toEndWith('/users/me')
    expect(h.calls[2]!.url).toEndWith('/clubs/club%20one')
    expect(h.calls.slice(1).every((call) => !call.init.method || call.init.method === 'GET')).toBe(
      true,
    )
  })

  test('distinguishes pending requests, absent membership, and malformed profile fields', async () => {
    const cases: { fields: Record<string, unknown>; expected: FloatyClubStatus }[] = [
      {
        fields: { clubId: null, pendingClubId: 'waiting' },
        expected: { kind: 'pending', clubId: 'waiting' },
      },
      { fields: { clubId: '', pendingClubId: null }, expected: { kind: 'none' } },
      { fields: {}, expected: { kind: 'none' } },
      { fields: { clubId: 7 }, expected: { kind: 'unknown' } },
      { fields: { pendingClubId: 7 }, expected: { kind: 'unknown' } },
    ]
    for (const sample of cases) {
      const h = harness([refresh, { body: { fields: encodeFields(sample.fields) } }])
      await h.client.restore()
      expect(await h.client.ownClubStatus()).toEqual(sample.expected)
      expect(h.calls).toHaveLength(2)
    }
  })

  test('club name permission failure preserves confirmed membership', async () => {
    const h = harness([
      refresh,
      { body: { fields: encodeFields({ clubId: 'club' }) } },
      { status: 403, body: {} },
    ])
    await h.client.restore()
    expect(await h.client.ownClubStatus()).toEqual({ kind: 'member', clubId: 'club', name: null })
  })

  test('profile permission failure or missing document is unknown, never no membership', async () => {
    for (const status of [403, 404]) {
      const h = harness([refresh, { status, body: {} }])
      await h.client.restore()
      expect(await h.client.ownClubStatus()).toEqual({ kind: 'unknown' })
    }
  })

  test('rejects stale profile and club-name responses after signing out', async () => {
    for (const delayedPath of ['/users/me', '/clubs/club']) {
      let resolveResponse!: (response: Response) => void
      let requested!: () => void
      const requestStarted = new Promise<void>((resolve) => {
        requested = resolve
      })
      const client = new FloatyClient(
        { read: async () => identity, write: async () => {} },
        (async (url) => {
          const path = String(url)
          if (path.endsWith(delayedPath)) {
            requested()
            return new Promise<Response>((resolve) => {
              resolveResponse = resolve
            })
          }
          return new Response(
            JSON.stringify(
              path.includes('securetoken')
                ? refresh.body
                : { fields: encodeFields({ clubId: 'club' }) },
            ),
          )
        }) as typeof fetch,
      )
      await client.restore()
      const result = client.ownClubStatus()
      await requestStarted
      await client.signOut()
      resolveResponse(
        new Response(
          JSON.stringify({ fields: encodeFields({ clubId: 'club', name: 'Old account club' }) }),
        ),
      )
      await expect(result).rejects.toThrow('Account changed')
    }
  })

  test('expires membership cache after one minute so a newly joined club is discovered', async () => {
    const h = harness([
      refresh,
      { body: { fields: encodeFields({ clubId: null }) } },
      { body: { fields: encodeFields({ clubId: 'new' }) } },
      { body: { fields: encodeFields({ name: 'New club' }) } },
    ])
    const realNow = Date.now
    let now = realNow()
    Date.now = () => now
    try {
      await h.client.restore()
      expect(await h.client.ownClubStatus()).toEqual({ kind: 'none' })
      now += 60_001
      expect(await h.client.ownClubStatus()).toEqual({
        kind: 'member',
        clubId: 'new',
        name: 'New club',
      })
      expect(h.calls).toHaveLength(4)
    } finally {
      Date.now = realNow
    }
  })
})

test('cached club status is also rejected if the account changes before delivery', async () => {
  const h = harness([refresh, { body: { fields: {} } }])
  await h.client.restore()
  await h.client.ownClubStatus()
  const pending = h.client.ownClubStatus()
  await h.client.signOut()
  await expect(pending).rejects.toThrow('Account changed')
})

describe('Super upload read-only payload comparison', () => {
  test('identical uploaded fields ignore remote names and scoring metadata without writing', async () => {
    const h = harness([
      refresh,
      {
        body: {
          fields: encodeFields({
            ...session,
            name: 'Edited in Floaty',
            tileCount: 50,
            groupRideId: 'group',
          }),
        },
      },
    ])
    await h.client.restore()
    expect(await h.client.compareReupload('me', session)).toEqual({
      kind: 'unchanged',
      changedFields: [],
    })
    expect(h.calls.slice(1).every((call) => !call.init.method || call.init.method === 'GET')).toBe(
      true,
    )
  })
  test('reports full route/privacy and summary changes with original identity untouched', async () => {
    const h = harness([refresh, { body: { fields: encodeFields(session) } }])
    await h.client.restore()
    const fresh = {
      ...session,
      polyline: '??BB',
      publicPolyline: '??CC',
      distance: 2,
      topSpeed: 21,
    }
    expect(await h.client.compareReupload('me', fresh)).toEqual({
      kind: 'changed',
      changedFields: ['distance', 'topSpeed', 'polyline', 'publicPolyline'],
    })
    expect(fresh.id).toBe(session.id)
    expect(fresh.startTime).toBe(session.startTime)
    expect(fresh.endTime).toBe(session.endTime)
    expect(h.calls).toHaveLength(2)
    expect(h.calls[1].init.body).toBeUndefined()
  })
  test('missing remote ride is reported without recreating it', async () => {
    const h = harness([refresh, { status: 404, body: {} }])
    await h.client.restore()
    expect(await h.client.compareReupload('me', session)).toEqual({
      kind: 'missing',
      changedFields: [],
    })
    expect(h.calls).toHaveLength(2)
  })
  test('validates the known previous range and rejects collisions or another account', async () => {
    const h = harness([
      refresh,
      { body: { fields: encodeFields(session) } },
      { body: { fields: encodeFields({ ...session, id: 'different' }) } },
    ])
    await h.client.restore()
    const fresh = { ...session, endTime: 3000 }
    expect(
      await h.client.compareReupload('me', fresh, {
        startAtMs: session.startTime,
        endAtMs: session.endTime,
      }),
    ).toEqual({ kind: 'changed', changedFields: ['endTime'] })
    await expect(h.client.compareReupload('me', session)).rejects.toThrow('no longer matches')
    await expect(h.client.compareReupload('other', session)).rejects.toThrow()
    expect(h.calls).toHaveLength(3)
    expect(h.calls.slice(1).every((call) => !call.init.method)).toBe(true)
  })
})

import { decodeFields, encodeFields, type FirestoreDocument } from './firestore'
import type { FloatyIdentity, FloatyPage, FloatyRider, FloatyRide, FloatySession } from './types'

// Public Firebase client identifier from Floaty's published Android application. Not a secret.
const API_KEY = 'AIzaSyAyKIKGcZf5ItmlXbZje7SFwYtqBEZUCuA'
const DOCUMENTS =
  'https://firestore.googleapis.com/v1/projects/floaty-app/databases/(default)/documents'
export class FloatyError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message)
    this.name = 'FloatyError'
  }
}
export type FloatyClubStatus =
  | { kind: 'member'; clubId: string; name: string | null }
  | { kind: 'pending'; clubId: string }
  | { kind: 'none' }
  | { kind: 'unknown' }

const CLUB_STATUS_TTL_MS = 60_000

export interface TokenVault {
  read(): Promise<FloatyIdentity | null>
  write(identity: FloatyIdentity | null): Promise<void>
}
export class FloatyClient {
  identity: FloatyIdentity | null = null
  private idToken: string | null = null
  private expiresAt = 0
  private generation = 0
  private refreshing: Promise<string> | null = null
  private vaultWrites: Promise<void> = Promise.resolve()
  private clubStatusCache: {
    uid: string
    generation: number
    expiresAt: number
    promise: Promise<FloatyClubStatus>
  } | null = null
  private saveIdentity(identity: FloatyIdentity | null, generation: number) {
    const write = this.vaultWrites.then(async () => {
      if (generation !== this.generation) return
      await this.vault.write(identity)
    })
    // intentional-suppression: the returned write reports failure to its caller; keep the serialization chain usable for disconnect/retry.
    this.vaultWrites = write.catch(() => undefined)
    return write
  }
  constructor(
    private vault: TokenVault,
    private transport: typeof fetch = fetch,
  ) {}
  async restore() {
    this.identity = await this.vault.read()
    return this.identity
  }
  private async request(
    url: string,
    init: RequestInit = {},
  ): Promise<Record<string, unknown> | unknown[]> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 25_000)
    try {
      const response = await this.transport(url, { ...init, signal: controller.signal })
      const body = (await response.json()) as Record<string, unknown>
      if (!response.ok) {
        const code = (body.error as { message?: string } | undefined)?.message ?? ''
        const message =
          code.includes('INVALID_LOGIN_CREDENTIALS') ||
          code.includes('INVALID_PASSWORD') ||
          code.includes('EMAIL_NOT_FOUND')
            ? 'Email or password is incorrect.'
            : code.includes('TOO_MANY_ATTEMPTS')
              ? 'Too many attempts. Please try again later.'
              : response.status === 403
                ? 'Floaty does not allow access to this data with your account.'
                : response.status === 401 ||
                    code.includes('TOKEN_EXPIRED') ||
                    code.includes('INVALID_REFRESH_TOKEN')
                  ? 'Your Floaty session has expired. Please reconnect your account.'
                  : `Floaty request failed (${response.status}). Please try again.`
        throw new FloatyError(message, response.status)
      }
      return body
    } catch (error) {
      if (error instanceof FloatyError) throw error
      throw new FloatyError('Could not reach Floaty. Check your connection and try again.')
    } finally {
      clearTimeout(timeout)
    }
  }
  async signIn(email: string, password: string) {
    const generation = ++this.generation
    const body = (await this.request(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password, returnSecureToken: true }),
      },
    )) as Record<string, unknown>
    if (generation !== this.generation) throw new FloatyError('Sign-in was cancelled.')
    if (
      typeof body.localId !== 'string' ||
      typeof body.refreshToken !== 'string' ||
      typeof body.idToken !== 'string'
    ) {
      throw new FloatyError('Floaty returned an invalid sign-in response.')
    }
    const identity = {
      uid: body.localId,
      email: String(body.email ?? email),
      refreshToken: body.refreshToken,
    }
    await this.saveIdentity(identity, generation)
    if (generation !== this.generation) throw new FloatyError('Sign-in was cancelled.')
    this.identity = identity
    this.idToken = body.idToken
    this.expiresAt = Date.now() + Number(body.expiresIn ?? 3600) * 1000
    return identity
  }
  async signOut() {
    ++this.generation
    this.identity = null
    this.idToken = null
    this.expiresAt = 0
    this.refreshing = null
    await this.saveIdentity(null, this.generation)
  }
  async resetPassword(email: string) {
    await this.request(
      `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestType: 'PASSWORD_RESET', email: email.trim() }),
      },
    )
  }
  private async token(): Promise<string> {
    if (!this.identity) throw new FloatyError('Connect your Floaty account first.', 401)
    if (this.idToken && Date.now() < this.expiresAt - 60_000) return this.idToken
    if (this.refreshing) return this.refreshing
    const generation = this.generation
    const identity = this.identity
    const promise = (async () => {
      const body = (await this.request(
        `https://securetoken.googleapis.com/v1/token?key=${API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(identity.refreshToken)}`,
        },
      )) as Record<string, unknown>
      if (generation !== this.generation || this.identity?.uid !== identity.uid)
        throw new FloatyError('Account changed.', 401)
      if (typeof body.id_token !== 'string' || body.user_id !== identity.uid)
        throw new FloatyError('Please reconnect your Floaty account.', 401)
      this.identity = {
        ...identity,
        refreshToken: String(body.refresh_token ?? identity.refreshToken),
      }
      await this.saveIdentity(this.identity, generation)
      if (generation !== this.generation) throw new FloatyError('Account changed.', 401)
      this.idToken = body.id_token
      this.expiresAt = Date.now() + Number(body.expires_in ?? 3600) * 1000
      return body.id_token
    })()
    this.refreshing = promise
    try {
      return await promise
    } finally {
      if (this.refreshing === promise) this.refreshing = null
    }
  }
  private async firestore(path: string, init: RequestInit = {}, uid = this.identity?.uid) {
    if (!uid || uid !== this.identity?.uid)
      throw new FloatyError('Account changed. Reconnect the account that queued this ride.', 401)
    const token = await this.token()
    if (uid !== this.identity?.uid) throw new FloatyError('Account changed.', 401)
    return this.request(`${DOCUMENTS}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    })
  }
  /** Read-only membership evidence; Floaty's server independently decides ride/tile credit. */
  async ownClubStatus(): Promise<FloatyClubStatus> {
    const uid = this.identity?.uid
    if (!uid) throw new FloatyError('Connect your Floaty account first.', 401)
    const generation = this.generation
    const assertAccount = () => {
      if (this.generation !== generation || this.identity?.uid !== uid)
        throw new FloatyError('Account changed.', 401)
    }
    const cached = this.clubStatusCache
    if (cached?.uid === uid && cached.generation === generation && cached.expiresAt > Date.now()) {
      const status = await cached.promise
      assertAccount()
      return status
    }
    const promise = (async (): Promise<FloatyClubStatus> => {
      try {
        const profile = (await this.firestore(
          `/users/${encodeURIComponent(uid)}`,
          {},
          uid,
        )) as unknown as FirestoreDocument
        assertAccount()
        if (!profile.fields || typeof profile.fields !== 'object' || Array.isArray(profile.fields))
          return { kind: 'unknown' }
        const fields = decodeFields(profile.fields)
        // Floaty's useUserClubIds maps the stored clubId to the UI alias myClubId.
        // pendingClubId is a join request, never proof of current membership.
        if (fields.clubId != null && typeof fields.clubId !== 'string') return { kind: 'unknown' }
        const clubId = typeof fields.clubId === 'string' ? fields.clubId.trim() : ''
        if (!clubId) {
          if (fields.pendingClubId != null && typeof fields.pendingClubId !== 'string')
            return { kind: 'unknown' }
          const pending =
            typeof fields.pendingClubId === 'string' ? fields.pendingClubId.trim() : ''
          return pending ? { kind: 'pending', clubId: pending } : { kind: 'none' }
        }
        let name: string | null = null
        try {
          const club = (await this.firestore(
            `/clubs/${encodeURIComponent(clubId)}`,
            {},
            uid,
          )) as unknown as FirestoreDocument
          assertAccount()
          const value = decodeFields(club.fields ?? {}).name
          if (typeof value === 'string' && value.trim()) name = value.trim()
        } catch {
          // A club may restrict its document; the user's clubId still confirms membership.
          assertAccount()
        }
        return { kind: 'member', clubId, name }
      } catch {
        assertAccount()
        return { kind: 'unknown' }
      }
    })()
    this.clubStatusCache = { uid, generation, expiresAt: Date.now() + CLUB_STATUS_TTL_MS, promise }
    return promise
  }

  async findRider(username: string): Promise<FloatyRider | null> {
    const name = username.trim().replace(/^@/, '')
    if (!name) return null
    const rows = (await this.firestore(':runQuery', {
      method: 'POST',
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'users' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'username' },
              op: 'EQUAL',
              value: { stringValue: name },
            },
          },
          limit: 1,
        },
      }),
    })) as { document?: FirestoreDocument }[]
    const doc = rows.find((row) => row.document)?.document
    if (!doc) return null
    const fields = decodeFields(doc.fields ?? {})
    return {
      uid: doc.name.split('/').pop()!,
      username: name,
      displayName: String(fields.displayName ?? name),
    }
  }
  async sessions(uid: string, pageToken?: string): Promise<FloatyPage> {
    const params = new URLSearchParams({ pageSize: '30', orderBy: 'startTime desc' })
    if (pageToken) params.set('pageToken', pageToken)
    const data = (await this.firestore(`/users/${encodeURIComponent(uid)}/sessions?${params}`)) as {
      documents?: FirestoreDocument[]
      nextPageToken?: string
    }
    return {
      rides: (data.documents ?? []).flatMap((doc) => {
        const f = decodeFields(doc.fields ?? {})
        if (typeof f.startTime !== 'number' || !Number.isFinite(f.startTime)) return []
        // Never fall back to the private route for another rider when a public route is absent.
        const route = uid === this.identity?.uid ? f.polyline : f.publicPolyline
        const ride: FloatyRide = {
          id: doc.name.split('/').pop()!,
          userId: uid,
          name: typeof f.name === 'string' ? f.name : 'Floaty ride',
          startTime: f.startTime,
          endTime: Number(f.endTime ?? f.startTime),
          distance: Number(f.distance ?? 0),
          topSpeed: Number(f.topSpeed ?? 0),
          polyline: typeof route === 'string' ? route : null,
        }
        return [ride]
      }),
      nextPageToken: data.nextPageToken,
    }
  }
  /** Read-only comparison of exactly the fields a reupload would replace. */
  async compareReupload(
    uid: string,
    session: FloatySession,
    previousRange?: { startAtMs: number; endAtMs: number },
  ): Promise<FloatyReuploadComparison> {
    const path = `/users/${encodeURIComponent(uid)}/sessions/${encodeURIComponent(session.id)}`
    let existing: FirestoreDocument
    try {
      existing = (await this.firestore(path, {}, uid)) as unknown as FirestoreDocument
    } catch (error) {
      if (error instanceof FloatyError && error.status === 404)
        return { kind: 'missing', changedFields: [] }
      throw error
    }
    const fields = decodeFields(existing.fields ?? {})
    assertReuploadIdentity(fields, session, previousRange)
    const patch = reuploadFields(session)
    const changedFields = (Object.keys(patch) as (keyof typeof patch)[]).filter(
      (key) => fields[key] !== patch[key],
    )
    return { kind: changedFields.length ? 'changed' : 'unchanged', changedFields }
  }

  /** Reupload the complete freshly exported route and session summary to the same ride.
   * This sends actual session data, not a tile-processing request. Preserve remote names,
   * group associations, and server-owned fields; never delete a ride to force processing. */
  async reupload(
    uid: string,
    session: FloatySession,
    previousRange?: { startAtMs: number; endAtMs: number },
  ): Promise<void> {
    const path = `/users/${encodeURIComponent(uid)}/sessions/${encodeURIComponent(session.id)}`
    let existing: FirestoreDocument
    try {
      existing = (await this.firestore(path, {}, uid)) as unknown as FirestoreDocument
    } catch (error) {
      if (error instanceof FloatyError && error.status === 404) return this.upload(uid, session)
      throw error
    }
    const fields = decodeFields(existing.fields ?? {})
    assertReuploadIdentity(fields, session, previousRange)
    if (!existing.updateTime)
      throw new FloatyError('Floaty did not return a ride version. Please retry.')
    const patch = reuploadFields(session)
    const params = new URLSearchParams({ 'currentDocument.updateTime': existing.updateTime })
    for (const key of Object.keys(patch)) params.append('updateMask.fieldPaths', key)
    await this.firestore(
      `${path}?${params}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ fields: encodeFields(patch) }),
      },
      uid,
    )
  }
  async upload(uid: string, session: FloatySession): Promise<void> {
    const path = `/users/${encodeURIComponent(uid)}/sessions/${encodeURIComponent(session.id)}`
    // Creation precondition makes a retry after a lost response idempotent, without overwriting a ride.
    try {
      await this.firestore(
        `${path}?currentDocument.exists=false`,
        {
          method: 'PATCH',
          body: JSON.stringify({ fields: encodeFields(session) }),
        },
        uid,
      )
    } catch (error) {
      if (!(error instanceof FloatyError) || (error.status !== 409 && error.status !== 400))
        throw error
      const existing = (await this.firestore(path, {}, uid)) as unknown as FirestoreDocument
      const fields = decodeFields(existing.fields ?? {})
      if (
        fields.id !== session.id ||
        fields.startTime !== session.startTime ||
        fields.endTime !== session.endTime
      ) {
        throw new FloatyError(
          'A different Floaty ride already uses this identifier. Nothing was overwritten.',
        )
      }
    }
  }
}

function reuploadFields(session: FloatySession) {
  return {
    startTime: session.startTime,
    endTime: session.endTime,
    distance: session.distance,
    topSpeed: session.topSpeed,
    timezone: session.timezone,
    polyline: session.polyline,
    publicPolyline: session.publicPolyline,
  }
}
export interface FloatyReuploadComparison {
  kind: 'missing' | 'unchanged' | 'changed'
  changedFields: (keyof ReturnType<typeof reuploadFields>)[]
}
function assertReuploadIdentity(
  fields: Record<string, unknown>,
  session: FloatySession,
  previousRange?: { startAtMs: number; endAtMs: number },
) {
  const matchesCurrent =
    fields.startTime === session.startTime && fields.endTime === session.endTime
  const matchesPrevious =
    previousRange != null &&
    fields.startTime === previousRange.startAtMs &&
    fields.endTime === previousRange.endAtMs
  if (fields.id !== session.id || (!matchesCurrent && !matchesPrevious)) {
    throw new FloatyError(
      'The remote ride no longer matches this recording. Nothing was overwritten.',
    )
  }
}

import type { FloatyPage, FloatyRide, FloatyRider } from './types'

export interface RideBrowserState {
  rides: FloatyRide[]
  rider: FloatyRider | null
  query: string | null
  loading: boolean
  loadingMore: boolean
  next?: string
  error: string | null
}
export const emptyRideBrowserState = (): RideBrowserState => ({
  rides: [],
  rider: null,
  query: null,
  loading: false,
  loadingMore: false,
  error: null,
})

/** One account-scoped view. New searches supersede all prior pages, successes and errors alike. */
export function createRideBrowser({
  uid,
  currentUid,
  client,
  publish,
}: {
  uid: string
  currentUid: () => string | undefined
  client: {
    sessions: (uid: string, token?: string) => Promise<FloatyPage>
    findRider: (username: string) => Promise<FloatyRider | null>
  }
  publish: (state: RideBrowserState) => void
}) {
  let state = emptyRideBrowserState()
  let generation = 0
  let disposed = false
  let consumed = new Set<string>()
  const valid = (ticket: number) => !disposed && ticket === generation && currentUid() === uid
  const update = (patch: Partial<RideBrowserState>) => {
    state = { ...state, ...patch }
    publish(state)
  }
  const errorText = (error: unknown) =>
    error instanceof Error ? error.message : 'Could not load rides. Please retry.'
  async function page(owner: string, ticket: number, token?: string) {
    try {
      const result = await client.sessions(owner, token)
      if (!valid(ticket)) return
      if (token) consumed.add(token)
      const rides = new Map((token ? state.rides : []).map((ride) => [ride.id, ride]))
      for (const ride of result.rides) rides.set(ride.id, ride)
      const next = result.nextPageToken
      update({
        rides: [...rides.values()],
        next: next && !consumed.has(next) ? next : undefined,
        loading: false,
        loadingMore: false,
      })
    } catch (error) {
      if (valid(ticket)) update({ error: errorText(error), loading: false, loadingMore: false })
    }
  }
  async function replace(query: string | null) {
    if (disposed || currentUid() !== uid) return
    const ticket = ++generation
    consumed = new Set()
    update({ ...emptyRideBrowserState(), query, loading: true })
    try {
      const rider = query ? await client.findRider(query) : null
      if (!valid(ticket)) return
      if (query && !rider) {
        update({ loading: false, error: 'No rider found with that exact Floaty username.' })
        return
      }
      update({ rider })
      await page(rider?.uid ?? uid, ticket)
    } catch (error) {
      if (valid(ticket)) update({ error: errorText(error), loading: false })
    }
  }
  return {
    own: () => replace(null),
    search: (username: string) => {
      const query = username.trim()
      return query ? replace(query) : Promise.resolve()
    },
    refresh: () => replace(state.query),
    loadMore: async () => {
      if (disposed || currentUid() !== uid || state.loading || !state.next) return
      const token = state.next
      const ticket = generation
      update({ loading: true, loadingMore: true, error: null })
      await page(state.rider?.uid ?? uid, ticket, token)
    },
    dispose: () => {
      disposed = true
      generation++
    },
  }
}

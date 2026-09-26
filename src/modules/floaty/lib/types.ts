export interface FloatyIdentity {
  uid: string
  email: string
  refreshToken: string
}
export interface FloatyRider {
  uid: string
  username: string
  displayName: string
}
export interface FloatyRide {
  id: string
  userId: string
  name: string
  startTime: number
  endTime: number
  distance: number
  topSpeed: number
  polyline: string | null
}
export interface FloatyPage {
  rides: FloatyRide[]
  nextPageToken?: string
}
export interface FloatySession {
  id: string
  distance: number
  topSpeed: number
  startTime: number
  endTime: number
  timezone: string
  polyline: string
  publicPolyline: string
  groupRideId: null
}
export interface UploadSource {
  recordingId?: string | null
  boardId: string | null
  boardName: string
  startAtMs: number
  endAtMs: number
  distanceM: number | null
  maxSpeedKmh: number
}
export interface FloatyUpload {
  id: string
  uid: string
  source: UploadSource
  status: 'queued' | 'uploading' | 'uploaded' | 'failed' | 'cancelled'
  attempts: number
  nextAttemptAt: number
  error?: string
  uploadedAt?: number
  /** Explicit full route/summary reupload to this same remote ride, never a duplicate. */
  reupload?: boolean
  remoteRange?: Pick<UploadSource, 'startAtMs' | 'endAtMs'>
}
export interface FloatyPreferences {
  territory: boolean
  heatmap: boolean
  autoUpload: boolean
  autoUploadSince: number
  autoUploadUid: string | null
}
export const DEFAULT_FLOATY_PREFERENCES: FloatyPreferences = {
  territory: false,
  heatmap: false,
  autoUpload: false,
  autoUploadSince: 0,
  autoUploadUid: null,
}

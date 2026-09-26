# Floaty integration

Floaty is a connected service independent of Vescape authentication. Connect an account from Settings → Connected services → Floaty. Settings contains account setup and automatic-sharing preferences only; there is no separate Floaty destination. Once connected, the main map exposes territory, heatmap, and community-ride controls. Ride History shows upload status alongside local rides and offers sharing, retry, cancellation, and reuploading in the existing ride detail actions. Disconnecting hides the service controls and clears selected remote routes and territory details without deleting local rides or remote uploads.

## Account and browsing

Sign in with an existing Floaty email/password. Passwords are sent directly to Firebase Authentication and are never persisted. Refresh tokens are stored with Expo SecureStore; access tokens remain in memory. Google-only accounts need an email/password configured through Floaty; this integration does not impersonate Floaty's Google OAuth client.

The main Vescape map renders Floaty's territory and heatmap vector tiles using its existing native Mapbox renderer, saved basemap, appearance, and camera. Mapbox requires `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN`. Tap the hexagon to toggle tiles; hold it for map layers. Community ride browsing and rider lookup live in Rides → Community, available once an account is connected. Weather and legal-limit modes hide these controls along with the overlays.

Ownership colors and club names use only Floaty's detailed published tiles at zoom 14, decoded into one GeoJSON source drawn by the native Mapbox renderer at every camera zoom. Lower-zoom server files can retain different owners even after a fresh download, so they are never used for ownership. Buffered fragments of the same cell are unioned to avoid overlapping fills and internal tile seams. Overview labels show one name per loaded club; detailed views show the published cell labels.

Loading follows the visible map after it settles, with at most 128 detailed tiles per viewport, four concurrent requests, a 12-second request timeout, and a memory-only LRU bounded to 384 tiles and 16 MB of estimated decoded data. Large regional/world views retain colors and names in loaded areas and explicitly say to zoom in for full coverage. This is not a complete worldwide ownership download. View changes cancel obsolete requests, and refresh discards the old generation. Every app launch uses a fresh cache version, stable across zoom changes; Reload published tiles advances it for ownership and heatmap data.

Tap a label for the controlling club; color-only territory polygons cannot reliably identify the owner, so their detail view says so. Reload tiles refreshes published map data without claiming server reprocessing. These are published snapshots, not guaranteed live ownership. The verified public tile schema exposes no claiming rider, associated route, capture date, or ownership history.

Community browsing opens in the Rides panel. Its independently scrolling list cannot dismiss the panel with a fast fling. It supports paginated personal sessions and exact-username rider lookup, subject to Floaty's Firestore permissions. Selecting a ride uses the native ride-detail layout and map framing, preserving privacy gaps and showing only the summary data Floaty provides. Other riders' routes use only `publicPolyline`. Distance and speed follow Vescape's unit preference. Browser state is scoped to the connected account.

## Sharing recordings

Manual uploads require confirmation. Automatic uploads are off by default; opting in applies only to recordings that start after opt-in and binds the setting to the connected account. Native Vescape recording remains the source of truth. Uploads use the full native GPX export rather than a decimated chart route. Native recording identity determines readiness. Active and idle-paused recordings cannot upload; an explicitly ended recording can upload after native closes and flushes it. There is no fixed three-minute wait. Upload readiness follows live native recording state. Automatic sharing checks when a recording ends, on foreground resume, and periodically while the app is open.

Enabled Vescape privacy zones, plus a 25-metre margin, are excluded from both uploaded route fields. Segments that cross a zone are split, including when neither endpoint falls inside it. Floaty's semicolon-separated polyline format preserves these breaks. No unmasked private route is uploaded. A route with no shareable segments is rejected.

The summary contains `id`, `distance` (km), `topSpeed` (km/h), `startTime` and `endTime` (Unix milliseconds), `timezone`, `polyline`, `publicPolyline`, and null `groupRideId`. It does not synthesize telemetry, tile claims, or achievements. Floaty's server controls eligibility and processing; successful storage does not guarantee scoring.

## Upload lifecycle

The foreground upload coordinator keeps alternating checkpoints in native document storage. It saves queued intent before networking and resumes interrupted work when Vescape opens. It is not an OS background upload service and makes no promise to finish while Vescape is suspended or terminated. Native ride recording continues independently.

Uploads use a deterministic document ID derived from native recording identity, or board/start time for legacy recordings. Creates require an absent document. A matching existing document recovers an interrupted success without replacing remote data. Network failures, rate limits, and server errors retry with bounded exponential backoff; other failures wait for explicit retry. Cancelled jobs retain a tombstone so automatic discovery does not enqueue them again. Disconnect pauses queued work; reconnecting the same account can resume it. Uploaded sessions and local recordings are never deleted by disconnect.

The small red **Super upload** action re-exports the completed native recording and reuploads its full shareable route and session summary to the same remote ride, including a corrected end time or fuller route. It sends actual session data; it is not a tile-processing request. The previous uploaded range is retained while queued so identity checks remain valid for previously truncated uploads. A version precondition and update mask protect concurrent edits and preserve remote names, group associations, and server-owned processing metadata. Retry/cancel/resume retain the reupload intent. Existing queued uploads from older builds retain their intent when migrated. Identical Firestore writes do not generate document update events. Reuploading does not promise tile credit or server reprocessing; the private tile worker’s handling of corrected existing sessions is not exposed by the client API.

## Service contract and verification

The integration uses Firebase Authentication REST, Firestore REST under `floaty-app`, and the public `cdn.floaty-app.com` vector endpoints. Contracts were checked against the Floaty reference repository and decoded public vector tiles. These are upstream application contracts, not a versioned Vescape service API, and may change.

Unit tests exercise authentication refresh and account changes, public-route selection, idempotent uploads, checkpoint/retry behavior, polyline encoding, and privacy masking. Live authenticated access and tile/achievement processing require a real Floaty account and must be verified against current server rules before release.

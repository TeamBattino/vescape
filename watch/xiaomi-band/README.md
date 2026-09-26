# Vescape for Xiaomi Smart Band 10

A read-only Vela companion for the 212 × 520 screen. Android Vescape owns the board connection and sends speed (km/h), duty (percent), and a small board-battery percentage through Mi Fitness, at up to 5 Hz (4 Hz with the default native watch cadence) (one idle frame every five seconds in Global compatibility mode). This does not depend on React Native remaining active. The band clears old readings after five seconds (checked twice per second). Thick continuous blue edge bars cover 0–60 km/h; yellow bars cover 0–100% duty. The larger numbers remain unclamped, with a smaller font for three-digit readings; board battery stays bright and prominent. A single waiting frame is replaced by newer values while Mi Fitness sends, then sent immediately when the transport completes and the rate limit permits. No FIFO backlog of old readings is retained. Missing duty is a dash, never a fabricated zero.

## Build

Use `bun install` then `bun run build` in this directory. `aiot-toolkit` is pinned to 2.0.5. Tests: `bun run test`. Scale assets are checked in; regenerate with Python + Pillow using `python tools/generate-scales.py`.

Mi Fitness requires the RPK package and signing certificate to match the phone app. The development manifest uses `app.vescape.dev`. Place matching PEM files in `sign/debug/private.pem` and `sign/debug/certificate.pem` before building. Do not commit signing keys. Production uses a different identity and needs its matching manifest/signature; the development RPK cannot talk to the store APK.

The generated RPK is under `dist/`. Install it using Mi Fitness's Vela developer installer or Xiaomi's supported developer tooling. Restart Mi Fitness after a first install if its cached app list still reports “app not installed.” Keep the existing band pairing.

## Connect

On Android, open Vescape → Settings → Watch → Xiaomi Smart Band. Enter the paired band's Mi Fitness device ID, then Connect band. Open on band launches the companion. The binding persists natively on the phone. Disconnect band removes only this binding; it does not unpair the band from Mi Fitness.

Mi Fitness 3.59.1i on Global Smart Band 10 omits third-party nodes and drops all incoming third-party packets, including the band's request for phone connection status. Vescape detects this through node discovery and enables a read-only compatibility path: it forwards an app-status request to Mi Fitness's exported SDK service, using only Vescape's own package and signing certificate. It sends frames without relying on unavailable band heartbeats. This is version-dependent behavior; no modified Mi Fitness APK or re-pairing is required. The phone explicitly labels one-way sending and does not claim band acknowledgements. This development version therefore accepts an explicit Mi Fitness device ID. It is the ID used in Mi Fitness diagnostics, not the Bluetooth MAC address or Xiaomi account ID. No user's ID is built into the app. Mi Fitness must remain installed, connected and allowed to run in the background. iOS reports this integration unsupported.

## Protocol and dependencies

JSON protocol version 1: band sends `vescape.hello` every two seconds while visible, `vescape.sleep` when hidden, and `vescape.ack` after receiving a frame. Android expires band presence after 6.5 seconds. `vescape.frame` contains `speed`, `duty`, `battery`, `stale` and `waiting`. Nullable values stay nullable. A waiting/stale frame clears both readings. The companion does not send board commands, upload routes or access accounts.

Android vendors the classes JAR from Xiaomi's official `xms-wearable-lib_1.4_release.aar` demo in `modules/vescape-core/android/libs/`, with its consumer shrinker rules. Source: [Xiaomi interconnect documentation](https://iot.mi.com/vela/quickapp/en/features/network/interconnect.html) and [official development demo](https://cdn.cnbj3-fusion.fds.api.mi-img.com/quickapp-vela/interconnect_dev_test_demo.zip). This is an external binary SDK, not Vescape-authored code; review Xiaomi distribution terms before a public release.

The dial has no app-name header, leaving more room between readings. Speed and duty digits
ease toward the latest received reading over 90 ms; colored scales interpolate
for 180 ms at up to 25 fps. New packets replace the target without overshoot. This
is display animation only, never stored telemetry; battery updates immediately.
First readings and unavailable/stale readings snap immediately; animation stops
when hidden and hidden pages ignore telemetry. Screen-on requests use the Vela
brightness module, retry failures while live, and release when hidden or stale.

Vela's [screen-on API](https://iot.mi.com/vela/quickapp/en/features/system/brightness.html)
keeps the display awake; it does not pin the app over system screens or notifications.
[Background support](https://iot.mi.com/vela/quickapp/en/guide/framework/other/background-running.html)
is documented for active audio, request and geolocation services, not interconnect.
The companion therefore reconnects on return instead of claiming uninterrupted
background execution. For fewer band interruptions, use the band's Control center
(right swipe from its home screen) → DND → On / 1 hr / 4 hrs, or Settings → DND settings.
[Xiaomi's Band 10 FAQ](https://www.mi.com/global/support/faq/details/KA-579104/)
says DND suppresses vibration and screen wake for calls/messages/app notifications;
alarms and health/system alerts can still interrupt. This app does not change band
or phone DND settings automatically.

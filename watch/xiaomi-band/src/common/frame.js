// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/XiaomiBandFrame.kt
export const EXPIRES_MS = 5000
export function decodeFrame(raw) {
  try {
    const frame = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!frame || frame.type !== 'vescape.frame' || frame.version !== 1) return null
    if (frame.waiting)
      return {
        state: 'WAITING FOR BOARD',
        speed: '--',
        duty: '--',
        battery: '--',
        speedScale: 0,
        dutyScale: 0,
      }
    if (frame.stale)
      return {
        state: 'SIGNAL LOST',
        speed: '--',
        duty: '--',
        battery: '--',
        speedScale: 0,
        dutyScale: 0,
      }
    const speed = numeric(frame.speed)
    const duty = numeric(frame.duty)
    const battery = numeric(frame.battery)
    return {
      state: speed === null && duty === null ? 'WAITING FOR BOARD' : 'LIVE',
      speed: speed === null ? '--' : Math.abs(speed).toFixed(0),
      duty: duty === null ? '--' : Math.abs(duty).toFixed(0),
      battery: battery === null ? '--' : Math.min(100, Math.max(0, battery)).toFixed(0) + '%',
      speedScale: scale(speed, 60),
      dutyScale: scale(duty, 100),
    }
  } catch (_) {
    return null
  }
}
function numeric(value) {
  return typeof value === 'number' && isFinite(value) ? value : null
}
function scale(value, maximum) {
  return value === null
    ? 0
    : Math.min(50, Math.max(0, Math.round((Math.abs(value) / maximum) * 50)))
}

// Display-only interpolation; never creates or stores telemetry samples.
const CHANNELS = ['speed', 'duty', 'speedText', 'dutyText']
export function createScaleMotion() {
  let channels = {}
  function reset() {
    channels = {}
  }
  function value(channel, now) {
    const progress = Math.max(0, Math.min(1, (now - channel.at) / channel.duration))
    return channel.from + (channel.to - channel.from) * progress
  }
  function target(frame, now) {
    for (const key of CHANNELS) {
      const numeric = key.endsWith('Text')
      const field = numeric ? key.slice(0, -4) : key
      const known = frame.state === 'LIVE' && frame[field] !== '--'
      const next = known ? (numeric ? Number(frame[field]) : frame[field + 'Scale']) : 0
      const previous = channels[key]
      const from = known && previous && previous.known ? value(previous, now) : next
      channels[key] = { from, to: next, at: now, known, duration: numeric ? 90 : 180 }
    }
  }
  function sample(now) {
    const result = { speed: 0, duty: 0, speedText: '--', dutyText: '--', done: true }
    for (const key of CHANNELS) {
      const channel = channels[key]
      if (!channel) continue
      const rounded = Math.round(value(channel, now))
      result[key] = key.endsWith('Text') ? (channel.known ? String(rounded) : '--') : rounded
      if (channel.from !== channel.to && now - channel.at < channel.duration) result.done = false
    }
    return result
  }
  return { reset, target, sample }
}

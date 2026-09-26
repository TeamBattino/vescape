// One half of the 212 x 520 capsule: bottom quarter arc, straight, top quarter arc.
// Native primitives avoid decoding and caching a new screen-size image every frame.
const ARC = (Math.PI * 98) / 2
const STRAIGHT = 308
export function capsuleSegments(scale) {
  const distance = (Math.max(0, Math.min(50, scale)) / 50) * (2 * ARC + STRAIGHT)
  const height = Math.round(Math.max(0, Math.min(STRAIGHT, distance - ARC)))
  return {
    Bottom: Math.max(0, Math.min(100, (distance / ARC) * 100)),
    Top: Math.max(0, Math.min(100, ((distance - ARC - STRAIGHT) / ARC) * 100)),
    FillTop: 414 - height,
    FillHeight: height,
  }
}

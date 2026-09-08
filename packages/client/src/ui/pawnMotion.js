// Sample one continuous journey through tile centers. Movement eases only at
// the start and finish, rather than braking and restarting on every square.
export function samplePawnPath(points, progress) {
  const count = points.length - 1
  if (count <= 0) return { ...points[0], dx: 0, dy: 0, reached: 0, fraction: 0 }
  const distance = Math.max(0, Math.min(1, progress)) * count
  const index = Math.min(count - 1, Math.floor(distance))
  const fraction = distance - index
  const a = points[index]
  const b = points[index + 1]
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1
  let dx = (b.x - a.x) / length
  let dy = (b.y - a.y) / length
  if (fraction > .7 && index + 2 < points.length) {
    const next = points[index + 2]
    const nextLength = Math.hypot(next.x - b.x, next.y - b.y) || 1
    const blend = (fraction - .7) / .3
    dx += ((next.x - b.x) / nextLength - dx) * blend
    dy += ((next.y - b.y) / nextLength - dy) * blend
  }
  return {
    x: a.x + (b.x - a.x) * fraction,
    y: a.y + (b.y - a.y) * fraction,
    dx, dy, fraction, reached: Math.floor(distance),
  }
}

// Piecewise-linear travel preserves tile centers, including sharp board corners.
export function samplePawnPath(points, progress) {
  if (!points.length) return { x: 0, y: 0, reached: 0, fraction: 0 }
  const distance = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0)) * (points.length - 1)
  const reached = Math.floor(distance)
  const fraction = distance - reached
  const a = points[reached]
  const b = points[Math.min(reached + 1, points.length - 1)]
  return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction, reached, fraction }
}

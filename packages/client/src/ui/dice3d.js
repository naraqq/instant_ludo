// A perspective-projected cube rendered with Phaser Graphics. Face numbers stay
// attached to the cube throughout the tumble; opposite sides always sum to 7.
const FACES = [
  { value: 1, n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { value: 6, n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
  { value: 3, n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { value: 4, n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { value: 2, n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { value: 5, n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
]
const PIPS = [[], [[0, 0]], [[-.45, -.45], [.45, .45]],
  [[-.45, -.45], [0, 0], [.45, .45]],
  [[-.45, -.45], [.45, -.45], [-.45, .45], [.45, .45]],
  [[-.45, -.45], [.45, -.45], [0, 0], [-.45, .45], [.45, .45]],
  [[-.45, -.48], [.45, -.48], [-.45, 0], [.45, 0], [-.45, .48], [.45, .48]]]

export function dicePose(value) {
  const rotations = { 1: [0, 0], 2: [-Math.PI / 2, 0], 3: [0, -Math.PI / 2],
    4: [0, Math.PI / 2], 5: [Math.PI / 2, 0], 6: [0, Math.PI] }
  const [x, y] = rotations[value]
  return { x, y }
}

function rotatePoint([x, y, z], pose) {
  const cy = y * Math.cos(pose.x) - z * Math.sin(pose.x)
  const cz = y * Math.sin(pose.x) + z * Math.cos(pose.x)
  const cx = x * Math.cos(pose.y) + cz * Math.sin(pose.y)
  const dz = -x * Math.sin(pose.y) + cz * Math.cos(pose.y)
  const tilt = pose.tilt ?? 1
  const tx = -.22 * tilt
  const ty = .28 * tilt
  const py = cy * Math.cos(tx) - dz * Math.sin(tx)
  const pz = cy * Math.sin(tx) + dz * Math.cos(tx)
  return [cx * Math.cos(ty) + pz * Math.sin(ty), py,
    -cx * Math.sin(ty) + pz * Math.cos(ty)]
}

function projectPoint(p) {
  const perspective = 8 / (8 - p[2])
  return { x: p[0] * 24.5 * perspective, y: p[1] * 24.5 * perspective }
}

export function projectDice(pose) {
  return FACES.map(face => {
    const normal = rotatePoint(face.n, pose)
    const point = (u, v) => projectPoint(rotatePoint(
      face.n.map((n, i) => n + face.u[i] * u + face.v[i] * v), pose))
    return { ...face, normal, point }
  }).filter(face => face.normal[2] > 1 / 8)
    .sort((a, b) => a.normal[2] - b.normal[2])
}

// Round the actual solid, including all twelve edges and eight corners.
// Merely rounding each flat face would leave holes between adjacent faces.
const RADIUS = .36
const INNER = 1 - RADIUS
const GRID = [-1, -.96, -.88, -.77, -INNER, INNER, .77, .88, .96, 1]
function roundedPoint(point) {
  const center = point.map(v => Math.max(-INNER, Math.min(INNER, v)))
  const offset = point.map((v, i) => v - center[i])
  const length = Math.hypot(...offset)
  return center.map((v, i) => v + offset[i] / length * RADIUS)
}

const SURFACE = FACES.flatMap(face => {
  const patches = []
  for (let i = 0; i < GRID.length - 1; i++) {
    for (let j = 0; j < GRID.length - 1; j++) {
      const coordinates = [[GRID[i], GRID[j]], [GRID[i + 1], GRID[j]],
        [GRID[i + 1], GRID[j + 1]], [GRID[i], GRID[j + 1]]]
      const vertices = coordinates.map(([u, v]) => roundedPoint(
        face.n.map((n, axis) => n + face.u[axis] * u + face.v[axis] * v)))
      const center = [0, 1, 2].map(axis => vertices.reduce((sum, v) => sum + v[axis], 0) / 4)
      const normal = center.map(v => v - Math.max(-INNER, Math.min(INNER, v)))
      const length = Math.hypot(...normal)
      patches.push({ vertices, center, normal: normal.map(v => v / length) })
    }
  }
  return patches
})

export function drawDice(graphics, pose) {
  graphics.clear()
  const patches = SURFACE.map(patch => ({
    center: rotatePoint(patch.center, pose),
    normal: rotatePoint(patch.normal, pose),
    vertices: patch.vertices,
  })).filter(({ center, normal }) =>
    normal[0] * -center[0] + normal[1] * -center[1] + normal[2] * (8 - center[2]) > 0)
    .sort((a, b) => a.center[2] - b.center[2])
  for (const patch of patches) {
    const light = Math.max(0, -.35 * patch.normal[0] - .45 * patch.normal[1] + .82 * patch.normal[2])
    const channel = Math.round(255 * (.77 + .23 * light))
    const color = (channel << 16) | (channel << 8) | channel
    const points = patch.vertices.map(v => projectPoint(rotatePoint(v, pose)))
    graphics.fillStyle(color, 1).fillPoints(points, true)
    // A tiny overlap prevents subpixel cracks between bevel patches.
    graphics.lineStyle(.35, color, 1).strokePoints(points, true)
  }
  for (const face of projectDice(pose)) {
    for (const [u, v] of PIPS[face.value]) {
      const circle = (offset, radius) => Array.from({ length: 24 }, (_, i) => {
        const angle = i * Math.PI / 12
        return face.point(u + Math.cos(angle) * radius, v + offset + Math.sin(angle) * radius)
      })
      const pr = face.value >= 5 ? .175 : .2
      graphics.fillStyle(0xffffff, .7).fillPoints(circle(.02, pr + .02), true)
      graphics.fillStyle(0x0d1019, 1).fillPoints(circle(0, pr), true)
    }
  }
}

// A clear, face-on result at rest, using the same graphics object as the tumble.
export function drawRestingDice(graphics, value) {
  graphics.clear()
  // soft drop shadow
  graphics.fillStyle(0x0a1020, .3).fillRoundedRect(-26, -21, 52, 54, 12)
  // body, lit from the top-left
  graphics.fillGradientStyle(0xffffff, 0xf4f6fb, 0xe4e8f2, 0xd7dceb, 1)
    .fillRoundedRect(-26, -26, 52, 52, 12)
  graphics.fillStyle(0xffffff, .5).fillRoundedRect(-22, -22, 44, 16, 8)
  graphics.lineStyle(1.5, 0xc7cfdd, 1).strokeRoundedRect(-26, -26, 52, 52, 12)
  // Six pips get a touch less room, so shrink them a hair.
  const r = value >= 5 ? 5.4 : 6.1
  for (const [u, v] of PIPS[value]) {
    graphics.fillStyle(0x000000, .14).fillCircle(u * 26 + 0.8, v * 26 + 1.1, r + 0.6)
    graphics.fillStyle(0x1b2436, 1).fillCircle(u * 26, v * 26, r)
    graphics.fillStyle(0xffffff, .22).fillCircle(u * 26 - r * .33, v * 26 - r * .33, r * .34)
  }
}

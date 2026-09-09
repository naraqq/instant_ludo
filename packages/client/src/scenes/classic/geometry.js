// Board coordinate system: grid <-> pixel conversion, pawn cell resolution and
// stack layout. Pure lookups against the board data + layout constants.
import { START_INDEX, TRACK, HOME_LANES, YARDS } from '@ludo/engine'
import { TILE, BOARD_X, BOARD_Y } from './constants.js'

// The spot a pawn glides to as it reaches home, before it takes its bow and
// leaves the board (parkFinishedPawn). A small 2x2 inside that colour's centre
// triangle (grid units): cx/cy is the cluster centre, hx/hy the half-spacing.
const FINISH_LAYOUT = {
  red: { cx: 6.55, cy: 7.5, hx: 0.25, hy: 0.35 },
  green: { cx: 7.5, cy: 6.55, hx: 0.35, hy: 0.25 },
  yellow: { cx: 8.45, cy: 7.5, hx: 0.25, hy: 0.35 },
  blue: { cx: 7.5, cy: 8.45, hx: 0.35, hy: 0.25 },
}

export const GeometryMixin = {
  // A centred 2x2 of home slots inside the tinted holder, spaced for the
  // (tall, feet-anchored) character art.
  yardSlots(color) {
    const [bx, by] = YARDS[color].box
    const cols = [bx + 2.1, bx + 3.9]
    const rows = [by + 2.3, by + 4.15]
    return [
      [cols[0], rows[0]],
      [cols[1], rows[0]],
      [cols[0], rows[1]],
      [cols[1], rows[1]],
    ]
  },

  getPawnStackKey(pawn) {
    const cell = this.getPawnCell(pawn)
    if (cell.type === 'track') return `track:${cell.index}`
    if (cell.type === 'home') return `${pawn.color}:home:${cell.index}`
    // each colour parks in its own triangle - don't merge the finish groups
    if (cell.type === 'finish') return `finish:${pawn.color}`
    return `${pawn.color}:yard:${cell.index}`
  },

  // A finished pawn's parking spot inside its colour's centre triangle.
  getFinishSlot(pawn) {
    const L = FINISH_LAYOUT[pawn.color]
    const col = pawn.id % 2 === 0 ? -1 : 1
    const row = pawn.id < 2 ? -1 : 1
    return this.gridToPixel(L.cx + col * L.hx, L.cy + row * L.hy)
  },

  getStackScale(count) {
    if (count <= 1) return 1
    if (count === 2) return 0.78
    if (count === 3) return 0.68
    if (count <= 4) return 0.6
    // safe squares and 2v2 partner cells can pile up 5-8 deep
    return count <= 6 ? 0.5 : 0.42
  },

  getStackOffsets(count) {
    if (count <= 1) return [{ x: 0, y: 0 }]
    if (count === 2) return [{ x: -7, y: -6 }, { x: 7, y: 6 }]
    if (count === 3) return [{ x: 0, y: -9 }, { x: -9, y: 7 }, { x: 9, y: 7 }]
    if (count <= 4) return [{ x: -9, y: -9 }, { x: 9, y: -9 }, { x: -9, y: 9 }, { x: 9, y: 9 }]
    // 5+ : even ring, top-first, tightening as the crowd grows
    const r = count <= 6 ? 12 : 14
    return Array.from({ length: count }, (_, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / count
      return { x: Math.round(Math.cos(a) * r), y: Math.round(Math.sin(a) * r) }
    })
  },

  getPawnCell(pawn) {
    if (pawn.steps === -1) return { type: 'yard', index: pawn.id }
    if (pawn.finished) return { type: 'finish' }
    if (pawn.steps < 51) return { type: 'track', index: (START_INDEX[pawn.color] + pawn.steps) % TRACK.length }
    return { type: 'home', index: pawn.steps - 51 }
  },

  getPawnPixel(pawn) {
    if (pawn.steps === -1) {
      const [gx, gy] = this.yardSlots(pawn.color)[pawn.id]
      return this.gridToPixel(gx, gy)
    }
    if (pawn.finished) return this.getFinishSlot(pawn)
    return this.getPixelFor(pawn.color, pawn.steps)
  },

  getPixelFor(color, steps) {
    if (steps >= 56) return this.gridToPixel(7.5, 7.5)
    if (steps < 51) {
      const index = (START_INDEX[color] + steps) % TRACK.length
      const [gx, gy] = TRACK[index]
      return this.gridToPixel(gx + 0.5, gy + 0.5)
    }
    const [gx, gy] = HOME_LANES[color][steps - 51]
    return this.gridToPixel(gx + 0.5, gy + 0.5)
  },

  getTrackPixel(index) {
    const [gx, gy] = TRACK[index]
    return this.gridToPixel(gx + 0.5, gy + 0.5)
  },

  // Grid -> pixel. `this._boardRot` (0-3 quarter turns, set only by the online
  // scene) rotates the whole board about its centre so the local player always
  // sits bottom-left. Everything visual routes through here, so pawns, gates,
  // runes and the board graphic all rotate together; sprites stay upright
  // because we only move points, never rotate the canvas.
  gridToPixel(gx, gy) {
    const k = (this._boardRot | 0) % 4
    let x = gx
    let y = gy
    if (k) {
      let rx = gx - 7.5
      let ry = gy - 7.5
      for (let n = 0; n < k; n++) {
        const t = rx
        rx = -ry
        ry = t
      }
      x = rx + 7.5
      y = ry + 7.5
    }
    return { x: BOARD_X + x * TILE, y: BOARD_Y + y * TILE }
  },
}

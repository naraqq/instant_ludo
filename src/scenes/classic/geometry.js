// Board coordinate system: grid <-> pixel conversion, pawn cell resolution and
// stack layout. Pure lookups against the board data + layout constants.
import { START_INDEX, TRACK, HOME_LANES, YARDS } from '../board.js'
import { TILE, BOARD_X, BOARD_Y } from './constants.js'

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
    if (cell.type === 'finish') return 'finish'
    return `${pawn.color}:yard:${cell.index}`
  },

  getStackScale(count) {
    if (count <= 1) return 1
    if (count === 2) return 0.78
    if (count === 3) return 0.68
    return 0.6
  },

  getStackOffsets(count) {
    if (count <= 1) return [{ x: 0, y: 0 }]
    if (count === 2) return [{ x: -7, y: -6 }, { x: 7, y: 6 }]
    if (count === 3) return [{ x: 0, y: -9 }, { x: -9, y: 7 }, { x: 9, y: 7 }]
    return [{ x: -9, y: -9 }, { x: 9, y: -9 }, { x: -9, y: 9 }, { x: 9, y: 9 }]
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
    if (pawn.finished) return this.gridToPixel(7.5, 7.5)
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

  gridToPixel(gx, gy) {
    return { x: BOARD_X + gx * TILE, y: BOARD_Y + gy * TILE }
  },
}

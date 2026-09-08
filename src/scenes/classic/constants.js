// Layout metrics and house-rule knobs for the Classic scene, split out so the
// scene modules can share them without a circular import through ClassicScene.
import { W, H } from '../../config.js'
import { START_INDEX } from '../board.js'

// Board fills the screen width (15 tiles = 720px), leaving generous top and
// bottom strips for the (bigger) player profiles.
export const TILE = 48
export const BOARD_SIZE = TILE * 15
export const BOARD_X = 0
export const BOARD_Y = (H - BOARD_SIZE) / 2 // board centred vertically
export const BOARD_BOTTOM = BOARD_Y + BOARD_SIZE
export const TURN_SECONDS = 30

export const BAR_Y = 1206 // bottom action bar

// House rules (tune freely)
export const SIX_PITY_LIMIT = 3          // force a 6 after this many straight non-6 rolls, per player
export const CAPTURE_GRANTS_CHARGE = true // landing on an opponent's pawn awards a power charge
export const CAPTURE_CHARGE_POOL = ['fire', 'water', 'earth']
export const POWER_SLOT_KEYS = ['fire', 'water', 'earth'] // buttons in the bottom bar (air auto-applies)

// Avatar profiles live in the strips above / below the board, not on it.
export const POD_R = 36
export const POD = {
  red: { ax: 78, ay: 116, dx: 196, dy: 120, dir: 'up' },
  green: { ax: W - 78, ay: 116, dx: W - 196, dy: 120, dir: 'up' },
  blue: { ax: 78, ay: BOARD_BOTTOM + 76, dx: 196, dy: BOARD_BOTTOM + 80, dir: 'down' },
  yellow: { ax: W - 78, ay: BOARD_BOTTOM + 76, dx: W - 196, dy: BOARD_BOTTOM + 80, dir: 'down' },
}

// track index of each colour's entry square (also a safe square)
export const START_OWNER = Object.fromEntries(
  Object.entries(START_INDEX).map(([c, i]) => [i, c])
)

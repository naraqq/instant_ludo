// Layout metrics and house-rule knobs for the Classic scene, split out so the
// scene modules can share them without a circular import through ClassicScene.
import { W, H } from '../../config.js'
import { START_INDEX } from '@ludo/engine'

// House-rule knobs now live in the headless engine so the scene and an
// authoritative server can never drift apart. Re-exported here for the scene
// modules that still import them from this file.
export { SIX_PITY_LIMIT, TURN_SECONDS, MOVE_SECONDS } from '@ludo/engine'

// The board spans the full width (15 tiles = 720px) and sits centred; the strips
// above and below scale with the (viewport-matched) canvas height and carry the
// player profiles + action bar.
export const TILE = 48
export const BOARD_SIZE = TILE * 15
export const BOARD_X = 0
// centred, but biased up a touch so the top HUD strip stays compact and the
// busier bottom control strip gets the extra room
export const BOARD_Y = Math.max(206, Math.round((H - BOARD_SIZE) / 2) - 74)
export const BOARD_BOTTOM = BOARD_Y + BOARD_SIZE

export const BAR_Y = H - 116 // bottom action bar, a thumb's reach up from the edge

export const POWER_SLOT_KEYS = ['fire', 'water', 'earth'] // buttons in the bottom bar (air auto-applies)

// Profiles float midway between the board edge and the screen chrome, so the
// space top and bottom reads as breathing room, not a void.
export const POD_R = 42
const TOP_MID = Math.round((58 + BOARD_Y) / 2)
const BOT_MID = Math.round((BOARD_BOTTOM + BAR_Y) / 2)
export const POD = {
  red: { ax: 88, ay: TOP_MID, dx: 220, dy: TOP_MID, dir: 'up' },
  green: { ax: W - 88, ay: TOP_MID, dx: W - 220, dy: TOP_MID, dir: 'up' },
  blue: { ax: 88, ay: BOT_MID, dx: 220, dy: BOT_MID, dir: 'down' },
  yellow: { ax: W - 88, ay: BOT_MID, dx: W - 220, dy: BOT_MID, dir: 'down' },
}

// track index of each colour's entry square (also a safe square)
export const START_OWNER = Object.fromEntries(
  Object.entries(START_INDEX).map(([c, i]) => [i, c])
)

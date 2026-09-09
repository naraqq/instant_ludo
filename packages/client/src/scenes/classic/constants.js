// Layout metrics and house-rule knobs for the Classic scene, split out so the
// scene modules can share them without a circular import through ClassicScene.
import { W, H } from '../../config.js'
import { START_INDEX } from '@ludo/engine'

// House-rule knobs now live in the headless engine so the scene and an
// authoritative server can never drift apart. Re-exported here for the scene
// modules that still import them from this file.
export { SIX_PITY_LIMIT, TURN_SECONDS } from '@ludo/engine'

// Board fills the screen width (15 tiles = 720px) and sits centred; the strips
// above and below carry the (bigger) player profiles, kept close to the board.
export const TILE = 48
export const BOARD_SIZE = TILE * 15
export const BOARD_X = 0
export const BOARD_Y = Math.round((H - BOARD_SIZE) / 2) // board centred vertically
export const BOARD_BOTTOM = BOARD_Y + BOARD_SIZE

export const BAR_Y = H - 128 // bottom action bar, a thumb's reach up from the edge

export const POWER_SLOT_KEYS = ['fire', 'water', 'earth'] // buttons in the bottom bar (air auto-applies)

// Avatar profiles float in the strips above / below the board, with balanced
// breathing room on both sides (the strips are unavoidably tall on a phone -
// board 720 + this chrome doesn't fill a portrait canvas, so we space it out
// rather than leave a void).
export const POD_R = 46
const TOP_MID = Math.round((58 + BOARD_Y) / 2)      // between the top chrome and the board
const BOT_MID = Math.round((BOARD_BOTTOM + BAR_Y) / 2) // between the board and the action bar
export const POD = {
  red: { ax: 86, ay: TOP_MID, dx: 218, dy: TOP_MID - 4, dir: 'up' },
  green: { ax: W - 86, ay: TOP_MID, dx: W - 218, dy: TOP_MID - 4, dir: 'up' },
  blue: { ax: 86, ay: BOT_MID, dx: 218, dy: BOT_MID + 4, dir: 'down' },
  yellow: { ax: W - 86, ay: BOT_MID, dx: W - 218, dy: BOT_MID + 4, dir: 'down' },
}

// track index of each colour's entry square (also a safe square)
export const START_OWNER = Object.fromEntries(
  Object.entries(START_INDEX).map(([c, i]) => [i, c])
)

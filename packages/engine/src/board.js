// Shared Ludo board data - imported by ClassicScene (rendering + rules) and
// ai.js (move evaluation). Pure data, no Phaser.

export const COLORS = ['red', 'green', 'yellow', 'blue']

// Bold, saturated board colours - classic Ludo, not pastel.
export const COLOR_HEX = {
  red: 0xc1272d,
  green: 0x179c3f,
  yellow: 0xf5b200,
  blue: 0x1f6fe0,
}
export const COLOR_DARK = {
  red: 0x8b141a,
  green: 0x0d6f2b,
  yellow: 0xc08600,
  blue: 0x134da8,
}
export const COLOR_LIGHT = {
  red: 0xd54a4a,
  green: 0x37bd5c,
  yellow: 0xffc734,
  blue: 0x4a90ea,
}
export const COLOR_SURFACE = {
  red: 0xf7dedb,
  green: 0xd6efdc,
  yellow: 0xfaeecb,
  blue: 0xd9e7fb,
}
export const BOARD_PALETTE = {
  track: 0xf5f7fc,
  safe: 0xcfd4dd,
  grid: 0x8793aa,
}
export const PAWN_ASSETS = {
  red: 'fire',
  green: 'earth',
  yellow: 'air',
  blue: 'water',
}
export const POWER_TYPES = ['fire', 'water', 'earth', 'air']
export const SAFE_STOPS = new Set([0, 8, 13, 21, 26, 34, 39, 47])
// Power gates: archways that straddle the seam JUST BEFORE each of these track
// squares (one midway along each quadrant's straight, clear of safe stops and
// corners). You walk through a gate - stepping onto its square or past it - to
// pick a power rune; you never stop "on" one. Spaced 13 apart, so a single move
// (max 12) passes at most one.
export const GATE_INDEXES = [7, 20, 33, 46]
export const START_INDEX = { red: 13, green: 26, yellow: 39, blue: 0 }
export const HOME_LANES = {
  red: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  green: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
  yellow: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
  blue: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
}
export const YARDS = {
  red: { box: [0, 0], pawns: [[2, 2], [4, 2], [2, 4], [4, 4]] },
  green: { box: [9, 0], pawns: [[11, 2], [13, 2], [11, 4], [13, 4]] },
  yellow: { box: [9, 9], pawns: [[11, 11], [13, 11], [11, 13], [13, 13]] },
  blue: { box: [0, 9], pawns: [[2, 11], [4, 11], [2, 13], [4, 13]] },
}
export const TRACK = [
  [6, 13], [6, 12], [6, 11], [6, 10], [6, 9], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8], [0, 7], [0, 6],
  [1, 6], [2, 6], [3, 6], [4, 6], [5, 6], [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0], [7, 0], [8, 0],
  [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6], [14, 7], [14, 8],
  [13, 8], [12, 8], [11, 8], [10, 8], [9, 8], [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14], [7, 14], [6, 14],
]

// steps at which a pawn crosses onto its private home lane / reaches the finish.
export const HOME_ENTRY = 51
export const FINISH_STEPS = 56

// Initial engine state. Pure: given a config + seed you always get the same
// starting position. `colors` is the seating order and drives turn rotation.
import { COLORS } from './board.js'
import { BONUS_RUNE_COUNT } from './constants.js'
import { makeRng } from './rng.js'
import { pickBonusIndex } from './rules.js'

const perColor = (colors, make) => Object.fromEntries(colors.map((c) => [c, make(c)]))

// config: { colors?: string[], seed?: number, startingInventory?: {fire,water,earth} }
export function createGame(config = {}) {
  const colors = (config.colors && config.colors.length >= 2 ? config.colors : COLORS).filter(
    (c) => COLORS.includes(c)
  )
  if (colors.length < 2) throw new Error('need at least 2 colours')

  const startInv = config.startingInventory || { fire: 0, water: 0, earth: 0 }

  const pawns = []
  for (const color of colors) {
    for (let id = 0; id < 4; id++) pawns.push({ color, id, steps: -1, finished: false })
  }

  // scatter the "+1" bonus-roll runes (deterministic from the seed)
  let rng = makeRng(config.seed ?? (Date.now() & 0x7fffffff))
  const bonusRunes = []
  for (let i = 0; i < BONUS_RUNE_COUNT; i++) {
    let index
    ;[index, rng] = pickBonusIndex(bonusRunes.map((r) => r.index), rng)
    bonusRunes.push({ index })
  }

  return {
    colors,
    pawns,
    bonusRunes,
    current: 0,
    phase: 'roll',
    dice: 0,
    raw: 0,
    forcedValue: null,
    doubleNext: false,
    extraRoll: false,
    pendingExtra: perColor(colors, () => false),
    inventory: perColor(colors, () => ({ ...startInv })),
    shielded: perColor(colors, () => false),
    shieldExpiresOnRoll: perColor(colors, () => false),
    pity: perColor(colors, () => 0),
    pityForced: perColor(colors, () => false),
    captures: perColor(colors, () => 0),
    pendingGate: null,
    winner: null,
    finishOrder: [],
    turn: 0, // monotonic counter, handy for clients / logging
    rng,
  }
}

// A deep-ish clone so reducers can mutate a working copy without touching input.
export function cloneState(s) {
  return {
    ...s,
    pawns: s.pawns.map((p) => ({ ...p })),
    bonusRunes: s.bonusRunes.map((r) => ({ ...r })),
    pendingExtra: { ...s.pendingExtra },
    inventory: Object.fromEntries(Object.entries(s.inventory).map(([k, v]) => [k, { ...v }])),
    shielded: { ...s.shielded },
    shieldExpiresOnRoll: { ...s.shieldExpiresOnRoll },
    pity: { ...s.pity },
    pityForced: { ...s.pityForced },
    captures: { ...s.captures },
    pendingGate: s.pendingGate ? { ...s.pendingGate } : null,
    finishOrder: [...s.finishOrder],
    rng: { ...s.rng },
  }
}

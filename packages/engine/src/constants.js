// House-rule knobs shared by the headless engine and (re-exported) the Phaser
// scene. Pure values, no rendering concerns.

export const SIX_PITY_LIMIT = 3           // force a 6 after this many straight non-6 rolls, per player
export const GATE_RUNES = ['fire', 'water', 'earth'] // the 3 storable powers, offered at a gate
export const BONUS_RUNE_COUNT = 4        // "+1" extra-roll runes scattered on the track

export const TURN_SECONDS = 30            // roll-phase clock
export const MOVE_SECONDS = 20            // move-phase clock

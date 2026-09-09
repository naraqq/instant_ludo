// House-rule knobs shared by the headless engine and (re-exported) the Phaser
// scene. Pure values, no rendering concerns.

export const SIX_PITY_LIMIT = 8           // after this many straight non-6 rolls, a "soft pity" nudge kicks in (per player)
export const SIX_PITY_NUDGE = 40          // % chance, once past the limit, that a rolled non-6 is upgraded to a 6
export const GATE_RUNES = ['fire', 'water', 'earth'] // the 3 storable powers, offered at a gate
export const BONUS_RUNE_COUNT = 4        // "+1" extra-roll runes scattered on the track

export const TURN_SECONDS = 30            // roll-phase clock
export const MOVE_SECONDS = 20            // move-phase clock

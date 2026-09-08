// House-rule knobs shared by the headless engine and (re-exported) the Phaser
// scene. Pure values, no rendering concerns.

export const SIX_PITY_LIMIT = 3           // force a 6 after this many straight non-6 rolls, per player
export const CAPTURE_GRANTS_CHARGE = true // landing on an opponent's pawn awards a power charge
export const CAPTURE_CHARGE_POOL = ['fire', 'water', 'earth']
export const GATE_RUNES = ['fire', 'water', 'earth', 'air'] // offered when a pawn passes a gate

export const TURN_SECONDS = 30            // roll-phase clock
export const MOVE_SECONDS = 20            // move-phase clock

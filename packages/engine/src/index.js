// Headless Ludo engine: framework-free rules the browser and the authoritative
// server both run. The client renders from (state, events); the server owns the
// seed and broadcasts the sanitised view.
export { createGame, cloneState } from './state.js'
export { reduce } from './reduce.js'
export {
  currentColor, legalMoves, canMovePawn, pawnCell, trackIndexOf,
  crossesGate, landingImpact,
} from './rules.js'
export * from './constants.js'
// Board topology + palette data. The client pulls all of this from the engine
// package so there is a single source of truth for TRACK / START_INDEX / gates.
export * from './board.js'
// Bot decision logic - pure, used by the client for local bots and by the
// server to fill empty / disconnected seats.
export { chooseAiMove, chooseAiPower, bestForcedDice, evaluateDiceValues, aiState } from './ai.js'

// Strip anything a client must not see (the RNG state lets you predict rolls).
export function publicView(state) {
  const { rng, ...rest } = state
  return rest
}

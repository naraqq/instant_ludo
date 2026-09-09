// Pure rule lookups over an engine state. No rendering, no mutation. (One
// function, pickBonusIndex, takes an rng and returns [value, nextRng].)
import {
  START_INDEX, TRACK, SAFE_STOPS, GATE_INDEXES, HOME_ENTRY, FINISH_STEPS,
} from './board.js'
import { rngPick } from './rng.js'

export const TRACK_LEN = TRACK.length // 52

// Where the next "+1" bonus rune lands: a track square that is not a safe stop,
// not a gate seam, and not already taken. `occupied` = indices to avoid.
export function pickBonusIndex(occupied, rng) {
  const blocked = new Set([...occupied, ...GATE_INDEXES])
  const candidates = []
  for (let i = 0; i < TRACK_LEN; i++) if (!SAFE_STOPS.has(i) && !blocked.has(i)) candidates.push(i)
  return rngPick(rng, candidates.length ? candidates : [...Array(TRACK_LEN).keys()])
}

// Track indices currently occupied by a pawn (for bonus-rune placement).
export function occupiedTrackIndices(state) {
  return state.pawns.map((p) => trackIndexOf(p)).filter((i) => i != null)
}

export function currentColor(state) {
  return state.colors[state.current]
}

// ---- teams (null / absent outside team mode) ----

export function teamOf(state, color) {
  return state.team ? state.team[color] ?? null : null
}

export function sameTeam(state, a, b) {
  if (!state.team) return a === b
  const ta = state.team[a]
  return ta != null && ta === state.team[b]
}

// The other colour on `color`'s team, or null.
export function teammate(state, color) {
  if (!state.team) return null
  const mine = state.team[color]
  return state.colors.find((c) => c !== color && state.team[c] === mine) ?? null
}

// Whose PAWNS move on the current turn. Normally the roller; in team mode, once
// the roller has all four pawns home, the dice drives their partner's pawns.
export function moverColor(state) {
  const roller = currentColor(state)
  if (!state.team) return roller
  if (pawnsOf(state, roller).some((p) => !p.finished)) return roller
  const mate = teammate(state, roller)
  if (mate && pawnsOf(state, mate).some((p) => !p.finished)) return mate
  return roller
}

export function pawnsOf(state, color) {
  return state.pawns.filter((p) => p.color === color)
}

export function findPawn(state, color, id) {
  return state.pawns.find((p) => p.color === color && p.id === id) || null
}

// Where a pawn sits, in board-agnostic terms.
export function pawnCell(pawn) {
  if (pawn.steps < 0) return { type: 'yard', index: pawn.id }
  if (pawn.finished || pawn.steps >= FINISH_STEPS) return { type: 'finish' }
  if (pawn.steps < HOME_ENTRY) {
    return { type: 'track', index: (START_INDEX[pawn.color] + pawn.steps) % TRACK_LEN }
  }
  return { type: 'home', index: pawn.steps - HOME_ENTRY }
}

// The shared-track square a pawn occupies, or null if in yard / home lane / done.
export function trackIndexOf(pawn) {
  if (pawn.steps < 0 || pawn.finished || pawn.steps >= HOME_ENTRY) return null
  return (START_INDEX[pawn.color] + pawn.steps) % TRACK_LEN
}

export function isSafe(trackIndex) {
  return SAFE_STOPS.has(trackIndex)
}

// Can this pawn legally move with the dice currently on the table?
export function canMovePawn(state, pawn) {
  if (pawn.finished) return false
  if (pawn.steps < 0) return state.raw === 6 || state.dice === 6
  return pawn.steps + state.dice <= FINISH_STEPS
}

// Pawn ids that can legally move now - the current player's, or (team mode, once
// they're all home) their partner's.
export function legalMoves(state) {
  return pawnsOf(state, moverColor(state))
    .filter((p) => canMovePawn(state, p))
    .map((p) => p.id)
}

// Destination step for a pawn moving now (does not mutate).
export function destStep(pawn, dice) {
  if (pawn.steps < 0) return 0
  return Math.min(pawn.steps + dice, FINISH_STEPS)
}

// Does travelling `from` -> `to` (in this colour's step space) pass through a
// gate? A gate sits on the seam just before its track square, so stepping onto
// that square or beyond counts. Gates are 13 apart: at most one per move.
export function crossesGate(color, from, to) {
  for (let step = Math.max(from + 1, 0); step <= to && step < HOME_ENTRY; step++) {
    if (GATE_INDEXES.includes((START_INDEX[color] + step) % TRACK_LEN)) return true
  }
  return false
}

// Who a pawn landing on `trackIndex` would hit: real captures vs shields that
// would absorb the blow. Safe squares capture nobody.
export function landingImpact(state, movedPawn, trackIndex) {
  const captured = []
  const blocked = []
  if (trackIndex == null || isSafe(trackIndex)) return { captured, blocked }
  for (const p of state.pawns) {
    if (p === movedPawn || sameTeam(state, p.color, movedPawn.color)) continue
    if (p.steps < 0 || p.finished) continue
    if (trackIndexOf(p) !== trackIndex) continue
    if (state.shielded[p.color]) blocked.push(p.color)
    else captured.push(p)
  }
  return { captured, blocked }
}

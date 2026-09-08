// Bot decision logic for Classic mode. Pure functions over a plain state
// snapshot the scene builds each turn - no Phaser, no scene references.

import { SAFE_STOPS, START_INDEX, TRACK, HOME_ENTRY, FINISH_STEPS, GATE_INDEXES } from './board.js'

// Adapt a full engine state into the lightweight snapshot the bot functions
// expect (current colour's view, `shielded` as a Set). The client's scene builds
// an equivalent shape itself today; the server calls this.
export function aiState(state, difficulty = 'normal') {
  const color = state.colors[state.current]
  return {
    color,
    dice: state.dice || 0,
    raw: state.raw || 0,
    pawns: state.pawns.map((p) => ({ color: p.color, id: p.id, steps: p.steps, finished: p.finished })),
    shielded: new Set(state.colors.filter((c) => state.shielded[c])),
    inventory: { ...state.inventory[color] },
    difficulty,
  }
}

// Does a move from `pawn.steps` to `to` sweep over (or land on) a power gate?
function crossesGate(pawn, to) {
  for (let step = Math.max(pawn.steps + 1, 0); step <= to && step < HOME_ENTRY; step++) {
    if (GATE_INDEXES.includes((START_INDEX[pawn.color] + step) % TRACK.length)) return true
  }
  return false
}

function trackOf(pawn) {
  if (pawn.steps < 0 || pawn.finished || pawn.steps >= HOME_ENTRY) return null
  return (START_INDEX[pawn.color] + pawn.steps) % TRACK.length
}

function legalMoves(state) {
  return state.pawns.filter((p) => {
    if (p.color !== state.color || p.finished) return false
    if (p.steps === -1) return state.raw === 6 || state.dice === 6
    return p.steps + state.dice <= FINISH_STEPS
  })
}

function landingInfo(state, pawn) {
  const from = pawn.steps
  const to = from === -1 ? 0 : from + state.dice
  return {
    to,
    leavingBase: from === -1,
    finishing: to === FINISH_STEPS,
    enteringHome: to >= HOME_ENTRY,
    trackIndex: to < HOME_ENTRY ? (START_INDEX[pawn.color] + to) % TRACK.length : null,
  }
}

function capturesAt(state, color, trackIndex) {
  if (trackIndex == null || SAFE_STOPS.has(trackIndex)) return []
  return state.pawns.filter(
    (p) =>
      p.color !== color &&
      p.steps >= 0 &&
      !p.finished &&
      !state.shielded.has(p.color) &&
      trackOf(p) === trackIndex
  )
}

// How many enemy pawns sit 1..6 squares behind `trackIndex` (i.e. could land on it).
function dangerAt(state, color, trackIndex) {
  if (trackIndex == null || SAFE_STOPS.has(trackIndex)) return 0
  let threat = 0
  for (const p of state.pawns) {
    if (p.color === color || p.steps < 0 || p.finished) continue
    const pi = trackOf(p)
    if (pi == null) continue
    const gap = (trackIndex - pi + TRACK.length) % TRACK.length
    if (gap >= 1 && gap <= 6) threat++
  }
  return threat
}

function scoreMove(state, pawn) {
  const L = landingInfo(state, pawn)
  let s = L.to * 0.5

  if (L.leavingBase) s += 35
  if (L.finishing) s += 120
  else if (L.enteringHome) s += 28 + (L.to - HOME_ENTRY) * 5

  for (const victim of capturesAt(state, pawn.color, L.trackIndex)) {
    s += 65 + victim.steps * 0.7
  }

  if (L.trackIndex != null && SAFE_STOPS.has(L.trackIndex)) s += 18

  if (crossesGate(pawn, L.to)) s += 20

  s -= dangerAt(state, pawn.color, L.trackIndex) * 14

  const cur = trackOf(pawn)
  if (cur != null && !SAFE_STOPS.has(cur)) {
    s += Math.min(dangerAt(state, pawn.color, cur), 3) * 9
  }
  return s
}

export function chooseAiMove(state) {
  const moves = legalMoves(state)
  if (moves.length === 0) return null
  if (moves.length === 1 || state.difficulty === 'easy') {
    return moves[Math.floor(Math.random() * moves.length)]
  }
  const scored = moves
    .map((p) => ({ p, s: scoreMove(state, p) }))
    .sort((a, b) => b.s - a.s)
  // Normal bots occasionally take the second-best line.
  if (state.difficulty === 'normal' && scored.length > 1 && Math.random() < 0.22) {
    return scored[1].p
  }
  return scored[0].p
}

export function evaluateDiceValues(state) {
  const results = []
  for (let value = 1; value <= 6; value++) {
    const sub = { ...state, dice: value, raw: value }
    const moves = legalMoves(sub)
    let best = moves.length ? -Infinity : -40
    for (const p of moves) best = Math.max(best, scoreMove(sub, p))
    results.push({ value, score: best })
  }
  return results
}

// Called during the roll phase (no dice yet). Returns a power key or null.
export function chooseAiPower(state) {
  if (state.difficulty !== 'hard') return null
  const inv = state.inventory || {}
  const mine = state.pawns.filter((p) => p.color === state.color)
  const onTrack = mine.filter((p) => p.steps >= 0 && !p.finished)

  if (inv.water > 0) {
    const evals = evaluateDiceValues(state)
    const best = Math.max(...evals.map((e) => e.score))
    const avg = evals.reduce((a, e) => a + e.score, 0) / evals.length
    if (best > avg + 45 && best > 60) return 'water'
  }

  if (inv.earth > 0) {
    const threatened = onTrack.some((p) => {
      const idx = trackOf(p)
      return idx != null && !SAFE_STOPS.has(idx) && dangerAt(state, state.color, idx) >= 1
    })
    if (threatened) return 'earth'
  }

  if (inv.fire > 0) {
    const canBurst = onTrack.some((p) =>
      [2, 4, 6, 8, 10, 12].some((base) => p.steps + base === FINISH_STEPS)
    )
    if (canBurst) return 'fire'
  }
  return null
}

export function bestForcedDice(state) {
  return evaluateDiceValues(state).sort((a, b) => b.score - a.score)[0].value
}

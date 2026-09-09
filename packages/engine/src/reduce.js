// The authoritative game step. reduce(state, action) -> { state, events, error }.
// Pure: never mutates its input. `events` is an ordered list the client plays
// out as animation; the server just broadcasts state + events.
import { FINISH_STEPS, GATE_INDEXES, START_INDEX } from './board.js'
import { SIX_PITY_LIMIT, SIX_PITY_NUDGE, GATE_RUNES } from './constants.js'
import { cloneState } from './state.js'
import { rngInt, rngPick } from './rng.js'
import {
  currentColor, findPawn, pawnsOf, legalMoves, canMovePawn, destStep,
  crossesGate, landingImpact, trackIndexOf, occupiedTrackIndices, pickBonusIndex, TRACK_LEN,
  moverColor, teamOf,
} from './rules.js'

const STORABLE = ['fire', 'water', 'earth']

function fail(state, error) {
  return { state, events: [], error }
}

function advanceTurn(s) {
  s.current = (s.current + 1) % s.colors.length
  s.turn++
}

function gateHit(color, from, to) {
  for (let step = Math.max(from + 1, 0); step <= to && step < 51; step++) {
    const idx = (START_INDEX[color] + step) % TRACK_LEN
    if (GATE_INDEXES.includes(idx)) return idx
  }
  return null
}

function progressOf(s, color) {
  return pawnsOf(s, color).reduce((sum, p) => sum + Math.max(p.steps, 0), 0)
}

function ranking(s) {
  const teamProgress = (c) => {
    if (s.team == null) return progressOf(s, c)
    return s.colors
      .filter((x) => s.team[x] === s.team[c])
      .reduce((sum, x) => sum + progressOf(s, x), 0)
  }
  return [...s.colors].sort((a, b) => {
    // team mode: the winning team's colours lead, then by combined progress
    if (s.team != null && s.winningTeam != null) {
      const aw = s.team[a] === s.winningTeam
      const bw = s.team[b] === s.winningTeam
      if (aw !== bw) return aw ? -1 : 1
    }
    if (a === s.winner) return -1
    if (b === s.winner) return 1
    const t = teamProgress(b) - teamProgress(a)
    return t !== 0 ? t : progressOf(s, b) - progressOf(s, a)
  })
}

// A gate always grants one of the three storable powers now.
function grantRune(s, color, key) {
  s.inventory[color][key]++
}

// Move the collected "+1" rune to a fresh square.
function respawnBonusRune(s) {
  const occupied = [...s.bonusRunes.map((r) => r.index), ...occupiedTrackIndices(s)]
  let index
  ;[index, s.rng] = pickBonusIndex(occupied, s.rng)
  s.bonusRunes.push({ index })
  return index
}

// Settle a hanging gate rune at random. Fired when the owner rolls their next
// turn without having chosen, or when a fresh gate pass would otherwise clobber
// someone else's still-pending pick.
function autoResolveGate(s, events) {
  if (!s.pendingGate) return
  const { color, index } = s.pendingGate
  let key
  ;[key, s.rng] = rngPick(s.rng, GATE_RUNES)
  grantRune(s, color, key)
  s.pendingGate = null
  events.push({ t: 'runePicked', color, key, index, deferred: true, auto: true })
}

// ---- the no-legal-move / end-of-turn plumbing, shared by roll and move ----

function closeTurn(s, events, color, extraReason) {
  if (!extraReason) {
    advanceTurn(s)
    s.sixRun[color] = 0 // the six-run only lives within a single player's turn
  }
  // a bonus roll continues this turn, so the shield must survive it - only arm
  // the expiry once the turn genuinely passes to another player
  if (!extraReason && s.shielded[color]) s.shieldExpiresOnRoll[color] = true
  s.extraRoll = false
  s.dice = 0
  s.raw = 0
  s.phase = 'roll'
  events.push({ t: 'turn', prev: color, color: currentColor(s), extra: extraReason || null })
}

// ---------------------------------------------------------------------------

function doRoll(s, events, explicitValue) {
  const color = currentColor(s)

  // Only the gate owner rolling again forces their own pick - another player's
  // roll must never resolve it (that was auto-picking runes out from under them).
  if (s.pendingGate && s.pendingGate.color === color) autoResolveGate(s, events)
  if (s.pendingExtra[color]) {
    s.pendingExtra[color] = false
    s.extraRoll = true
    events.push({ t: 'extraRoll', color, cause: 'air' })
  }

  if (s.shielded[color] && s.shieldExpiresOnRoll[color]) {
    s.shielded[color] = false
    s.shieldExpiresOnRoll[color] = false
    events.push({ t: 'shieldExpired', color })
  }

  const doubled = s.doubleNext
  s.doubleNext = false

  let raw
  if (explicitValue != null) {
    raw = explicitValue
  } else if (s.forcedValue != null) {
    raw = s.forcedValue
  } else {
    ;[raw, s.rng] = rngInt(s.rng, 1, 6)
    // soft pity: a long six-drought only earns a nudge, never a guaranteed 6
    if (raw !== 6 && s.pityForced[color]) {
      let nudge
      ;[nudge, s.rng] = rngInt(s.rng, 1, 100)
      if (nudge <= SIX_PITY_NUDGE) raw = 6
    }
  }
  s.forcedValue = null

  s.raw = raw
  s.dice = doubled ? raw * 2 : raw

  if (raw === 6) {
    s.pity[color] = 0
    s.pityForced[color] = false
    s.sixRun[color] = (s.sixRun[color] || 0) + 1
  } else {
    s.sixRun[color] = 0
    s.pity[color]++
    if (s.pity[color] >= SIX_PITY_LIMIT) s.pityForced[color] = true
  }

  events.push({ t: 'rolled', color, raw, dice: s.dice, doubled })

  // Three sixes in a row: the third is void. No move, the turn passes.
  if (raw === 6 && s.sixRun[color] >= 3) {
    s.sixRun[color] = 0
    events.push({ t: 'sixForfeit', color })
    closeTurn(s, events, color, null)
    return { state: s, events }
  }

  s.phase = 'move'

  const moves = legalMoves(s)
  if (moves.length === 0) {
    const extraReason = s.extraRoll ? 'air' : raw === 6 ? 'six' : null
    events.push({ t: 'noMove', color })
    closeTurn(s, events, color, extraReason)
  }
  return { state: s, events }
}

function doMove(s, events, pawnId, gateRune) {
  const roller = currentColor(s)      // whose turn / dice / inventory / clock
  const mover = moverColor(s)         // whose pawn actually moves (team assist)
  const assist = mover !== roller
  if (!legalMoves(s).includes(pawnId)) return fail(s, 'illegal move')
  const pawn = findPawn(s, mover, pawnId)

  const from = pawn.steps
  const to = destStep(pawn, s.dice)
  pawn.steps = to
  if (to >= FINISH_STEPS) {
    pawn.finished = true
    pawn.steps = FINISH_STEPS
  }
  events.push(assist
    ? { t: 'moved', color: mover, pawnId, from, to: pawn.steps, roller, assist: true }
    : { t: 'moved', color: mover, pawnId, from, to: pawn.steps })

  // gate - the pawn's owner passes it, but whoever's turn it is makes the pick
  // (and banks the rune), so the picker UI stays on the active seat
  const gate = gateHit(mover, from, pawn.steps)
  if (gate != null) {
    events.push({ t: 'gate', color: mover, pawnId, index: gate, picker: roller })
    if (gateRune && GATE_RUNES.includes(gateRune)) {
      grantRune(s, roller, gateRune)
      events.push({ t: 'runePicked', color: roller, key: gateRune, index: gate, deferred: false })
    } else {
      // a hanging pick from another seat can't ride across a second gate pass
      if (s.pendingGate && s.pendingGate.color !== roller) autoResolveGate(s, events)
      s.pendingGate = assist
        ? { color: roller, pawnId, pawnColor: mover, index: gate }
        : { color: roller, pawnId, index: gate }
    }
  }

  // "+1" bonus rune - landing on one grants an extra roll (to the roller), then
  // the rune moves on
  const landIndex = trackIndexOf(pawn)
  const bi = landIndex == null ? -1 : s.bonusRunes.findIndex((r) => r.index === landIndex)
  if (bi >= 0) {
    s.bonusRunes.splice(bi, 1)
    s.extraRoll = true
    events.push({ t: 'bonus', color: mover, pawnId, index: landIndex, roller })
    events.push({ t: 'bonusSpawn', index: respawnBonusRune(s) })
  }

  // captures
  const impact = landingImpact(s, pawn, trackIndexOf(pawn))
  for (const c of impact.blocked) {
    s.shielded[c] = false
    s.shieldExpiresOnRoll[c] = false
    events.push({ t: 'shieldBlock', color: c, by: mover })
  }
  if (impact.captured.length) {
    s.captures[roller] += impact.captured.length
    for (const victim of impact.captured) {
      victim.steps = -1
      victim.finished = false
      events.push({ t: 'capture', color: victim.color, id: victim.id, by: mover })
    }
  }

  if (pawn.finished) events.push({ t: 'finish', color: mover, pawnId })

  // a colour bringing all four home: records the placing. In team mode this is
  // NOT the end - the partner plays on until all eight are home.
  if (pawn.finished && pawnsOf(s, mover).every((p) => p.finished) && !s.finishOrder.includes(mover)) {
    s.finishOrder.push(mover)
    if (s.team) events.push({ t: 'colorHome', color: mover })
  }

  const teamDone = s.team
    ? s.colors.filter((c) => teamOf(s, c) === teamOf(s, mover)).every(
      (c) => pawnsOf(s, c).every((p) => p.finished)
    )
    : pawnsOf(s, mover).every((p) => p.finished)

  if (teamDone && !s.winner) {
    s.winner = mover
    if (s.team) s.winningTeam = teamOf(s, mover)
    s.phase = 'gameover'
    s.dice = 0
    s.raw = 0
    events.push(s.team ? { t: 'win', color: mover, team: s.winningTeam } : { t: 'win', color: mover })
    events.push({ t: 'gameover', winner: mover, winningTeam: s.winningTeam, ranking: ranking(s) })
    return { state: s, events }
  }

  const extraReason = s.extraRoll
    ? 'air'
    : impact.captured.length > 0
      ? 'capture'
      : pawn.finished
        ? 'finish'
        : s.raw === 6
          ? 'six'
          : null
  closeTurn(s, events, roller, extraReason)
  return { state: s, events }
}

function doUsePower(s, events, key, value) {
  const color = currentColor(s)
  if (s.phase !== 'roll') return fail(s, 'power only before rolling')
  if (!STORABLE.includes(key)) return fail(s, 'unknown power')
  if ((s.inventory[color][key] || 0) <= 0) return fail(s, 'no charge')

  if (key === 'fire') {
    if (s.doubleNext) return fail(s, 'fire already active')
    s.inventory[color].fire--
    s.doubleNext = true
    events.push({ t: 'powerUsed', color, key: 'fire' })
  } else if (key === 'water') {
    if (s.forcedValue != null) return fail(s, 'water already active')
    if (!(value >= 1 && value <= 6)) return fail(s, 'water needs a face 1-6')
    s.inventory[color].water--
    s.forcedValue = value
    events.push({ t: 'powerUsed', color, key: 'water', value })
  } else {
    // shield protects "your pawns" - once they're all home it does nothing, so
    // an assisting player's fire/water still help their partner but earth won't
    s.inventory[color].earth--
    s.shielded[color] = true
    s.shieldExpiresOnRoll[color] = false
    events.push({ t: 'powerUsed', color, key: 'earth' })
  }
  return { state: s, events }
}

function doPickGateRune(s, events, key) {
  if (!s.pendingGate) return fail(s, 'no gate pick pending')
  if (!GATE_RUNES.includes(key)) return fail(s, 'unknown rune')
  const { color, index } = s.pendingGate
  grantRune(s, color, key)
  s.pendingGate = null
  events.push({ t: 'runePicked', color, key, index, deferred: true })
  return { state: s, events }
}

// ---------------------------------------------------------------------------

export function reduce(prev, action) {
  if (prev.phase === 'gameover') return fail(prev, 'game over')
  const s = cloneState(prev)
  const events = []

  switch (action.type) {
    case 'usePower':
      return doUsePower(s, events, action.key, action.value)

    case 'roll':
      if (s.phase !== 'roll') return fail(prev, 'not the roll phase')
      return doRoll(s, events, action.value)

    case 'move':
      if (s.phase !== 'move') return fail(prev, 'not the move phase')
      return doMove(s, events, action.pawnId, action.gateRune)

    case 'pickGateRune':
      return doPickGateRune(s, events, action.key)

    case 'timeout':
      if (s.phase === 'roll') return doRoll(s, events)
      if (s.phase === 'move') {
        const moves = legalMoves(s)
        if (!moves.length) return fail(prev, 'move phase with no moves')
        let id
        ;[id, s.rng] = rngPick(s.rng, moves)
        return doMove(s, events, id)
      }
      return fail(prev, 'nothing to time out')

    default:
      return fail(prev, `unknown action ${action.type}`)
  }
}

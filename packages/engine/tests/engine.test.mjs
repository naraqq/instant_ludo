import assert from 'node:assert/strict'
import test from 'node:test'
import { createGame, reduce, publicView, legalMoves, currentColor } from '../src/index.js'
import { START_INDEX } from '../src/board.js'

// The engine is framework-free, so these tests import it straight - no stubs.

const game = (over = {}) => createGame({ colors: ['blue', 'red'], seed: 42, ...over })
// force a specific die face
const roll = (s, value) => reduce(s, { type: 'roll', value }).state
const step = (s, action) => reduce(s, action)

test('createGame lays out a clean starting position', () => {
  const s = game({ colors: ['blue', 'red', 'green', 'yellow'] })
  assert.equal(s.pawns.length, 16)
  assert.equal(s.pawns.every((p) => p.steps === -1 && !p.finished), true)
  assert.equal(s.phase, 'roll')
  assert.equal(currentColor(s), 'blue')
  assert.deepEqual(s.inventory.blue, { fire: 0, water: 0, earth: 0 })
})

test('same seed -> same play-out, different seed -> different', () => {
  const rollSeq = (seed, n) => {
    let s = createGame({ colors: ['blue', 'red'], seed })
    const out = []
    for (let i = 0; i < n && s.phase !== 'gameover'; i++) {
      const r = reduce(s, { type: 'roll' })
      out.push(r.events.find((e) => e.t === 'rolled').raw)
      s = r.state
      if (s.phase === 'move') s = reduce(s, { type: 'timeout' }).state
    }
    return out
  }
  assert.deepEqual(rollSeq(42, 25), rollSeq(42, 25))
  assert.notDeepEqual(rollSeq(42, 25), rollSeq(7, 25))
})

test('a non-6 with everyone in the yard just passes the turn', () => {
  const s = game()
  const { state, events } = step(s, { type: 'roll', value: 3 })
  assert.equal(events.some((e) => e.t === 'noMove'), true)
  assert.equal(state.phase, 'roll')
  assert.equal(currentColor(state), 'red')
})

test('a 6 lets a pawn leave the yard and keeps the turn', () => {
  let s = game()
  s = roll(s, 6)
  assert.equal(s.phase, 'move')
  assert.deepEqual(legalMoves(s), [0, 1, 2, 3])
  const { state, events } = step(s, { type: 'move', pawnId: 0 })
  assert.equal(state.pawns.find((p) => p.color === 'blue' && p.id === 0).steps, 0)
  assert.equal(events.find((e) => e.t === 'turn').extra, 'six')
  assert.equal(currentColor(state), 'blue') // still blue's turn
})

test('fire doubles the next roll', () => {
  let s = game({ startingInventory: { fire: 1, water: 0, earth: 0 } })
  const used = step(s, { type: 'usePower', key: 'fire' })
  assert.equal(used.state.doubleNext, true)
  assert.equal(used.state.inventory.blue.fire, 0)
  const rolled = step(used.state, { type: 'roll', value: 3 })
  assert.equal(rolled.events[0].raw, 3)
  assert.equal(rolled.events[0].dice, 6)
  assert.equal(rolled.events[0].doubled, true)
})

test('water forces the face', () => {
  let s = game({ startingInventory: { fire: 0, water: 1, earth: 0 } })
  s = step(s, { type: 'usePower', key: 'water', value: 5 }).state
  const rolled = step(s, { type: 'roll' })
  assert.equal(rolled.events[0].raw, 5)
})

test('landing on an opponent captures it and grants a charge', () => {
  let s = game()
  const blue = s.pawns.find((p) => p.color === 'blue' && p.id === 0)
  const red = s.pawns.find((p) => p.color === 'red' && p.id === 0)
  blue.steps = 3
  // red sits on blue's track index 5 ((START_INDEX.blue + 5) % 52 == 5)
  red.steps = (5 - START_INDEX.red + 52) % 52
  s = roll(s, 2) // blue 3 -> 5, onto red
  const { state, events } = step(s, { type: 'move', pawnId: 0 })
  assert.equal(events.some((e) => e.t === 'capture' && e.color === 'red'), true)
  assert.equal(state.pawns.find((p) => p.color === 'red' && p.id === 0).steps, -1)
  const charged = events.find((e) => e.t === 'charge')
  assert.ok(charged && state.inventory.blue[charged.key] === 1)
})

test('a shield absorbs the hit instead of being captured', () => {
  let s = game({ startingInventory: { fire: 0, water: 0, earth: 1 } })
  // red raises a shield on its turn... simpler: set state directly
  s.shielded.red = true
  const blue = s.pawns.find((p) => p.color === 'blue' && p.id === 0)
  const red = s.pawns.find((p) => p.color === 'red' && p.id === 0)
  blue.steps = 3
  red.steps = (5 - START_INDEX.red + 52) % 52
  s = roll(s, 2)
  const { state, events } = step(s, { type: 'move', pawnId: 0 })
  assert.equal(events.some((e) => e.t === 'shieldBlock'), true)
  assert.equal(events.some((e) => e.t === 'capture'), false)
  assert.equal(state.shielded.red, false)
  assert.equal(state.pawns.find((p) => p.color === 'red' && p.id === 0).steps >= 0, true)
})

test('passing a gate offers a rune - inline or deferred', () => {
  let s = game()
  const blue = s.pawns.find((p) => p.color === 'blue' && p.id === 0)
  blue.steps = 5 // blue gate is the seam before step 7
  s = roll(s, 3) // 5 -> 8, through the gate
  const inline = step(s, { type: 'move', pawnId: 0, gateRune: 'fire' })
  assert.equal(inline.events.some((e) => e.t === 'gate'), true)
  assert.equal(inline.events.some((e) => e.t === 'runePicked' && !e.deferred), true)
  assert.equal(inline.state.inventory.blue.fire, 1)
  assert.equal(inline.state.pendingGate, null)

  // deferred path
  let d = game()
  d.pawns.find((p) => p.color === 'blue' && p.id === 0).steps = 5
  d = roll(d, 3)
  const moved = step(d, { type: 'move', pawnId: 0 })
  assert.deepEqual(moved.state.pendingGate, { color: 'blue', pawnId: 0 })
  const picked = step(moved.state, { type: 'pickGateRune', key: 'earth' })
  assert.equal(picked.state.inventory.blue.earth, 1)
  assert.equal(picked.state.pendingGate, null)
})

test('an air rune deferred at a gate becomes the next-turn bonus roll', () => {
  let s = game()
  s.pawns.find((p) => p.color === 'blue' && p.id === 0).steps = 5
  s = roll(s, 3)
  s = step(s, { type: 'move', pawnId: 0 }).state // turn -> red, pendingGate blue
  s = step(s, { type: 'pickGateRune', key: 'air' }).state
  assert.equal(s.pendingExtra.blue, true)
  // red plays a nothing turn
  s = step(s, { type: 'roll', value: 2 }).state
  assert.equal(currentColor(s), 'blue')
  const back = step(s, { type: 'roll', value: 2 })
  assert.equal(back.events.some((e) => e.t === 'extraRoll'), true)
})

test('pity: three straight non-6s force a 6', () => {
  let s = game()
  s = step(s, { type: 'roll', value: 2 }).state // blue, non-6, no move -> red
  s = step(s, { type: 'roll', value: 2 }).state // red -> blue
  s = step(s, { type: 'roll', value: 2 }).state // blue (2nd) -> red
  s = step(s, { type: 'roll', value: 2 }).state // red -> blue
  s = step(s, { type: 'roll', value: 2 }).state // blue (3rd) -> red
  s = step(s, { type: 'roll', value: 2 }).state // red -> blue
  assert.equal(s.pityForced.blue, true)
  const forced = step(s, { type: 'roll' }) // no explicit value -> pity kicks in
  assert.equal(forced.events[0].raw, 6)
  assert.equal(forced.state.pityForced.blue, false)
})

test('first player home wins', () => {
  let s = game()
  const blues = s.pawns.filter((p) => p.color === 'blue')
  blues.forEach((p, i) => { if (i < 3) { p.finished = true; p.steps = 56 } else p.steps = 55 })
  s = roll(s, 1)
  const { state, events } = step(s, { type: 'move', pawnId: 3 })
  assert.equal(state.phase, 'gameover')
  assert.equal(state.winner, 'blue')
  assert.equal(events.some((e) => e.t === 'gameover'), true)
  assert.equal(reduce(state, { type: 'roll' }).error, 'game over')
})

test('invalid actions are rejected without touching state', () => {
  const s = game()
  assert.equal(step(s, { type: 'move', pawnId: 0 }).error, 'not the move phase')
  assert.equal(step(s, { type: 'usePower', key: 'fire' }).error, 'no charge')
  assert.equal(step(s, { type: 'nope' }).error, 'unknown action nope')
  const after = roll(s, 6)
  assert.equal(reduce(after, { type: 'move', pawnId: 3, gateRune: null }).error ?? 'ok', 'ok')
})

test('timeout auto-plays the current phase', () => {
  let s = game()
  const t1 = step(s, { type: 'timeout' }) // roll phase -> rolls
  assert.equal(t1.events[0].t, 'rolled')
  s = roll(s, 6)
  const t2 = step(s, { type: 'timeout' }) // move phase -> plays a legal move
  assert.equal(t2.events.some((e) => e.t === 'moved'), true)
})

test('publicView hides the rng', () => {
  const s = game()
  assert.equal(publicView(s).rng, undefined)
  assert.equal(publicView(s).phase, 'roll')
})

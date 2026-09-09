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

test('landing on an opponent sends it home and grants an extra turn (no rune)', () => {
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
  assert.equal(events.some((e) => e.t === 'charge'), false)
  assert.deepEqual(state.inventory.blue, { fire: 0, water: 0, earth: 0 })
  // capturing keeps the turn (extra roll)
  assert.equal(currentColor(state), 'blue')
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

test("another player's roll does not resolve a hanging gate pick", () => {
  let s = game()
  s.pawns.find((p) => p.color === 'blue' && p.id === 0).steps = 5
  s = roll(s, 3)
  s = step(s, { type: 'move', pawnId: 0 }).state // blue through the gate, turn -> red
  assert.deepEqual(s.pendingGate, { color: 'blue', pawnId: 0 })
  assert.equal(currentColor(s), 'red')

  // red rolls: blue's pick must still be waiting, and blue got no rune
  const redRolled = step(s, { type: 'roll', value: 3 })
  assert.deepEqual(redRolled.state.pendingGate, { color: 'blue', pawnId: 0 })
  assert.equal(redRolled.events.some((e) => e.t === 'runePicked'), false)
  assert.deepEqual(redRolled.state.inventory.blue, { fire: 0, water: 0, earth: 0 })

  // blue can still choose it during red's turn
  const picked = step(redRolled.state, { type: 'pickGateRune', key: 'water' })
  assert.equal(picked.state.inventory.blue.water, 1)
  assert.equal(picked.state.pendingGate, null)
})

test('the game seeds four "+1" bonus runes, clear of safe stops and gates', () => {
  const s = game()
  assert.equal(s.bonusRunes.length, 4)
  const idxs = s.bonusRunes.map((r) => r.index)
  assert.equal(new Set(idxs).size, 4, 'no duplicates')
  for (const i of idxs) {
    assert.equal([0, 8, 13, 21, 26, 34, 39, 47].includes(i), false, 'not a safe stop')
    assert.equal([7, 20, 33, 46].includes(i), false, 'not a gate seam')
  }
})

test('landing on a "+1" rune grants an extra roll and the rune moves on', () => {
  let s = game()
  const blue = s.pawns.find((p) => p.color === 'blue' && p.id === 0)
  const runeIdx = s.bonusRunes.find((r) => r.index >= 3 && r.index <= 45).index
  blue.steps = runeIdx - 2 // blue step == track index for blue (START 0)
  const before = s.bonusRunes.map((r) => r.index).sort((a, b) => a - b)
  s = roll(s, 2) // land exactly on the rune
  const { state, events } = step(s, { type: 'move', pawnId: 0 })
  assert.equal(events.some((e) => e.t === 'bonus' && e.index === runeIdx), true)
  assert.equal(events.some((e) => e.t === 'bonusSpawn'), true)
  assert.equal(state.bonusRunes.length, 4, 'always four on the board')
  assert.notDeepEqual(state.bonusRunes.map((r) => r.index).sort((a, b) => a - b), before)
  assert.equal(currentColor(state), 'blue', 'extra roll: still blue')
  assert.equal(events.find((e) => e.t === 'turn').extra, 'air')
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

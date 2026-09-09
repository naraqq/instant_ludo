import assert from 'node:assert/strict'
import test from 'node:test'
import { createGame, reduce, publicView, legalMoves, currentColor } from '../src/index.js'
import { SIX_PITY_LIMIT } from '../src/constants.js'
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

test('three 6s in a row: the third is void and the turn passes', () => {
  let s = game()
  // first 6 - leave the yard, still blue's turn
  s = roll(s, 6)
  s = step(s, { type: 'move', pawnId: 0 }).state
  assert.equal(currentColor(s), 'blue')
  assert.equal(s.sixRun.blue, 1)
  // second 6 - move again, still blue's turn
  s = roll(s, 6)
  s = step(s, { type: 'move', pawnId: 0 }).state
  assert.equal(currentColor(s), 'blue')
  assert.equal(s.sixRun.blue, 2)
  // third 6 - forfeited: no move phase, turn passes, streak reset
  const third = step(s, { type: 'roll', value: 6 })
  assert.equal(third.events.some((e) => e.t === 'sixForfeit' && e.color === 'blue'), true)
  assert.equal(third.state.phase, 'roll')
  assert.equal(currentColor(third.state), 'red')
  assert.equal(third.state.sixRun.blue, 0)
  const bluePawn = third.state.pawns.find((p) => p.color === 'blue' && p.id === 0)
  assert.equal(bluePawn.steps, 6, 'the pawn did not move on the void six')
})

test('a non-6 between sixes resets the run', () => {
  let s = game()
  s = roll(s, 6)
  s = step(s, { type: 'move', pawnId: 0 }).state
  s = roll(s, 3) // resets the run; blue at step 6 -> 9, then turn passes
  assert.equal(s.sixRun.blue, 0)
  s = step(s, { type: 'move', pawnId: 0 }).state
  assert.equal(currentColor(s), 'red')
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
  assert.deepEqual(moved.state.pendingGate, { color: 'blue', pawnId: 0, index: 7 })
  const picked = step(moved.state, { type: 'pickGateRune', key: 'earth' })
  assert.equal(picked.events[0].index, 7)
  assert.equal(picked.state.inventory.blue.earth, 1)
  assert.equal(picked.state.pendingGate, null)
})

test("another player's roll does not resolve a hanging gate pick", () => {
  let s = game()
  s.pawns.find((p) => p.color === 'blue' && p.id === 0).steps = 5
  s = roll(s, 3)
  s = step(s, { type: 'move', pawnId: 0 }).state // blue through the gate, turn -> red
  assert.deepEqual(s.pendingGate, { color: 'blue', pawnId: 0, index: 7 })
  assert.equal(currentColor(s), 'red')

  // red rolls: blue's pick must still be waiting, and blue got no rune
  const redRolled = step(s, { type: 'roll', value: 3 })
  assert.deepEqual(redRolled.state.pendingGate, { color: 'blue', pawnId: 0, index: 7 })
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

test('soft pity: a long six-drought arms a nudge, not a guaranteed 6', () => {
  let s = game()
  // blue rolls a non-6 every other turn until it hits the pity limit
  for (let i = 0; i < SIX_PITY_LIMIT; i++) {
    s = step(s, { type: 'roll', value: 2 }).state // blue: non-6, no move -> red
    s = step(s, { type: 'roll', value: 2 }).state // red -> blue
  }
  assert.equal(s.pity.blue, SIX_PITY_LIMIT)
  assert.equal(s.pityForced.blue, true)

  // once armed, pity rolls are *biased* toward 6 but not forced: across many
  // seeds we still see some non-sixes, and the six-rate sits well above 1/6.
  let sixes = 0
  const trials = 400
  for (let seed = 0; seed < trials; seed++) {
    let d = game({ seed })
    for (let i = 0; i < SIX_PITY_LIMIT; i++) {
      d = step(d, { type: 'roll', value: 2 }).state
      d = step(d, { type: 'roll', value: 2 }).state
    }
    if (step(d, { type: 'roll' }).events[0].raw === 6) sixes++
  }
  assert.ok(sixes > 0 && sixes < trials, `pity roll not deterministic (${sixes}/${trials})`)
  assert.ok(sixes / trials > 1 / 6, `pity should raise the six-rate (${sixes}/${trials})`)
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

// ---- 2v2 team play -------------------------------------------------------

// seat order blue, red, green, yellow -> blue+green (team 0) vs red+yellow (1)
const teamGame = (over = {}) =>
  createGame({ colors: ['blue', 'red', 'green', 'yellow'], seed: 42, teams: true, ...over })
const allHome = (s, color) =>
  s.pawns.filter((p) => p.color === color).forEach((p) => { p.finished = true; p.steps = 56 })

test('team mode pairs seats diagonally', () => {
  const s = teamGame()
  assert.deepEqual(s.team, { blue: 0, red: 1, green: 0, yellow: 1 })
  assert.equal(s.winningTeam, null)
})

test('teammates never capture each other, enemies still do', () => {
  let s = teamGame()
  s.pawns.find((p) => p.color === 'blue' && p.id === 0).steps = 1
  s.pawns.find((p) => p.color === 'green' && p.id === 0).steps = 29 // track idx 3
  s.pawns.find((p) => p.color === 'red' && p.id === 0).steps = 42  // track idx 3
  s = roll(s, 2) // blue 1 -> 3
  const { state, events } = step(s, { type: 'move', pawnId: 0 })
  assert.equal(events.some((e) => e.t === 'capture' && e.color === 'red'), true)
  assert.equal(events.some((e) => e.t === 'capture' && e.color === 'green'), false)
  assert.equal(state.pawns.find((p) => p.color === 'green' && p.id === 0).steps, 29)
})

test('one colour finishing all four does NOT end a team game', () => {
  let s = teamGame()
  s.pawns.filter((p) => p.color === 'blue').forEach((p, i) => {
    if (i < 3) { p.finished = true; p.steps = 56 } else { p.steps = 55 }
  })
  s = roll(s, 1)
  const { state, events } = step(s, { type: 'move', pawnId: 3 })
  assert.equal(events.some((e) => e.t === 'colorHome' && e.color === 'blue'), true)
  assert.equal(events.some((e) => e.t === 'gameover'), false)
  assert.notEqual(state.phase, 'gameover')
  assert.equal(state.winner, null)
  assert.equal(state.finishOrder.includes('blue'), true)
})

test('a finished player rolls to move their partner (partner assist)', () => {
  let s = teamGame()
  allHome(s, 'blue')
  s.pawns.filter((p) => p.color === 'green').forEach((p, i) => { p.steps = i === 0 ? 10 : -1 })
  const rolled = step(s, { type: 'roll', value: 3 })
  assert.equal(currentColor(rolled.state), 'blue', 'still blue\'s turn / dice')
  assert.deepEqual(legalMoves(rolled.state), [0], 'only green\'s on-track pawn can move')
  const moved = step(rolled.state, { type: 'move', pawnId: 0 })
  const mv = moved.events.find((e) => e.t === 'moved')
  assert.equal(mv.color, 'green')
  assert.equal(mv.assist, true)
  assert.equal(mv.roller, 'blue')
})

test('a team wins only once all eight pawns are home', () => {
  let s = teamGame()
  allHome(s, 'blue')
  s.pawns.filter((p) => p.color === 'green').forEach((p, i) => {
    if (i < 3) { p.finished = true; p.steps = 56 } else { p.steps = 55 }
  })
  s = roll(s, 1) // blue's turn, assists green's last pawn home
  const { state, events } = step(s, { type: 'move', pawnId: 3 })
  assert.equal(state.phase, 'gameover')
  assert.equal(state.winningTeam, 0)
  const go = events.find((e) => e.t === 'gameover')
  assert.equal(go.winningTeam, 0)
  // winning team's colours lead the ranking
  assert.equal(state.team[go.ranking[0]], 0)
  assert.equal(state.team[go.ranking[1]], 0)
})

test('the roller keeps their own six-run while assisting', () => {
  let s = teamGame()
  allHome(s, 'blue')
  s.pawns.filter((p) => p.color === 'green').forEach((p) => { p.steps = 10 })
  s = step(s, { type: 'roll', value: 6 }).state
  s = step(s, { type: 'move', pawnId: 0 }).state // blue rolled a 6 -> extra roll, still blue
  assert.equal(currentColor(s), 'blue')
  assert.equal(s.sixRun.blue, 1)
  assert.equal(s.sixRun.green, 0)
})

test('publicView hides the rng', () => {
  const s = game()
  assert.equal(publicView(s).rng, undefined)
  assert.equal(publicView(s).phase, 'roll')
})

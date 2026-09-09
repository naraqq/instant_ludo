import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import vm from 'node:vm'
import * as board from '@ludo/engine'
import * as pawnMotion from '../src/ui/pawnMotion.js'

const ENGINE_INDEX = new URL('../../engine/src/index.js', import.meta.url)

// Evaluate the real scene (now split into mixin modules under scenes/classic/)
// with only the renderer / audio / persistence boundaries stubbed. Every other
// project module is compiled from disk so the whole graph loads for real.
const stubs = {
  phaser: { default: { Utils: { Array: { GetRandom: (a) => a[0] } }, Math: { Between: (a) => a } } },
  '/ui/UIScene.js': { UIScene: class {} },
  '/audio.js': { sfx: { rune() {}, hop() {}, power() {}, tap() {} } },
  '/store.js': { store: {} },
  '/i18n.js': { t: key => key },
}

function synthetic(exports) {
  return new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
  })
}

const compiled = new Map()
async function compile(url) {
  if (compiled.has(url.href)) return compiled.get(url.href)
  const source = await readFile(fileURLToPath(url), 'utf8')
  const mod = new vm.SourceTextModule(source, { identifier: url.href })
  compiled.set(url.href, mod)
  return mod
}

async function linker(specifier, referencing) {
  if (specifier === 'phaser') return synthetic(stubs.phaser)
  // the engine package is pure - compile it from disk like any relative module
  if (specifier === '@ludo/engine') return compile(ENGINE_INDEX)
  const resolved = new URL(specifier, referencing.identifier)
  for (const [suffix, exports] of Object.entries(stubs)) {
    if (suffix !== 'phaser' && resolved.pathname.endsWith(suffix)) return synthetic(exports)
  }
  return compile(resolved)
}

const module = await compile(new URL('../src/scenes/ClassicScene.js', import.meta.url))
await module.link(linker)
await module.evaluate()
const { ClassicScene } = module.namespace

function display(x = 0, y = 0) {
  return {
    x, y, visible: true,
    setAlpha() { return this }, setDepth() { return this },
    setVisible(value) { this.visible = value; return this },
    setText(value) { this.text = value; return this },
    destroy() { this.destroyed = true },
  }
}
function scene() {
  const s = new ClassicScene()
  s.activeColors = ['blue', 'red']
  s.currentPlayer = 0
  s.youColor = 'blue'
  s.players = { blue: 'human', red: 'ai' }
  s.phase = 'roll'
  s.powerInventory = { blue: { fire: 0, water: 0, earth: 0 }, red: { fire: 0, water: 0, earth: 0 } }
  s.powerButtons = Object.fromEntries(['fire', 'water', 'earth'].map(key => [key, {
    container: display(100, 1200), icon: display(), badge: display(), countText: display(), zone: { input: {} },
  }]))
  s.playerBadges = { blue: display(80, 1000), red: display(80, 100) }
  s.pending = []
  s.killed = []
  s.tweens = { add: config => s.pending.push(config), killTweensOf: target => s.killed.push(target) }
  s.popAt = () => {}
  s.markPawnHome = () => {}
  s.collectBonusRune = () => {}
  s.flashes = []
  s.flashPower = key => s.flashes.push(key)
  s.getPawnCell = pawn => ({ type: 'track', index: pawn.index })
  s.pendingExtraRoll = new Set()
  return s
}

// ---------- power buttons ----------

test('human inventory stays visible but disabled during enemy turns', () => {
  const s = scene()
  s.powerInventory.blue.fire = 2
  s.powerInventory.red.fire = 8
  s.currentPlayer = 1
  s.updatePowerButtons()
  assert.equal(s.powerButtons.fire.countText.text, '2')
  assert.equal(s.powerButtons.fire.badge.visible, true)
  assert.equal(s.powerButtons.fire.zone.input.enabled, false)
  s.currentPlayer = 0
  s.updatePowerButtons()
  assert.equal(s.powerButtons.fire.zone.input.enabled, true)
})

test('local hot-seat bar follows the active human', () => {
  const s = scene()
  s.youColor = null
  s.players.red = 'human'
  s.currentPlayer = 1
  s.powerInventory.red.water = 3
  s.updatePowerButtons()
  assert.equal(s.powerButtons.water.countText.text, '3')
  assert.equal(s.powerButtons.water.zone.input.enabled, true)
})

// ---------- power gates ----------

test('moveCrossesGate flags a move that walks through a gate', () => {
  const s = scene()
  // blue's first gate is the seam before track index 7, i.e. blue step 7
  assert.equal(s.moveCrossesGate('blue', 4, 9), 7, 'walked through')
  assert.equal(s.moveCrossesGate('blue', 4, 7), 7, 'stepped onto the far square')
  assert.equal(s.moveCrossesGate('blue', 4, 6), null, 'stopped on the near side')
  assert.equal(s.moveCrossesGate('blue', 8, 12), null, 'already past it')
  assert.equal(s.moveCrossesGate('blue', 0, 5), null, 'not there yet')
  // leaving the yard (from -1 to 0) never touches a gate
  assert.equal(s.moveCrossesGate('blue', -1, 0), null)
  // home-lane steps (>= 51) carry no gates
  assert.equal(s.moveCrossesGate('blue', 50, 56), null)
  // red is offset by its start index; global gate 20 == red step 7
  assert.equal(s.moveCrossesGate('red', 4, 9), 20)
  assert.equal(s.moveCrossesGate('red', 4, 6), null)
})

test('applyGateRune adds the chosen storable power to the inventory', () => {
  const s = scene()
  s.applyGateRune('blue', 'fire')
  assert.equal(s.powerInventory.blue.fire, 1)
  assert.equal(s.powerButtons.fire.countText.text, '1')
  s.applyGateRune('blue', 'earth')
  assert.equal(s.powerInventory.blue.earth, 1)
})

test('landing on a "+1" rune grants an extra roll and respawns it', () => {
  const s = scene()
  delete s.collectBonusRune // use the real method, not the scene() stub
  s.phase = 'moving'
  s.currentPlayer = 0 // blue
  s.bonusRunes = [{ slot: 0, index: 7 }, { slot: 1, index: 20 }]
  s.bonusRuneViews = new Map()
  const respawned = []
  s.spawnBonusRune = (slot) => respawned.push(slot)
  s.animateBonusCollect = (_r, _c, done) => done()

  s.collectBonusRune({ color: 'blue', index: 7 })
  assert.equal(s.extraRollNextTurn, true)
  assert.equal(s.bonusRunes.length, 1)
  assert.deepEqual(respawned, [0])

  // a pawn on a plain square collects nothing
  s.extraRollNextTurn = false
  s.collectBonusRune({ color: 'blue', index: 99 })
  assert.equal(s.extraRollNextTurn, false)
})

test('resolveGatePass does nothing when the move missed every gate', () => {
  const s = scene()
  s._gatePass = null
  s.showGatePicker = () => assert.fail('no picker without a gate')
  s.resolveGatePass({ color: 'blue' })
  assert.ok(true)
})

test('a bot picks a gate rune at once, without a picker', () => {
  const s = scene()
  s.currentPlayer = 1
  s._gatePass = 7
  s.pickGateRuneForBot = () => 'earth'
  const grants = []
  s.animateGateGrant = (color, key) => grants.push({ color, key })
  s.showGatePicker = () => assert.fail('bots never see the picker')
  s.resolveGatePass({ color: 'red' })
  assert.equal(s._gatePass, null)
  assert.deepEqual(grants, [{ color: 'red', key: 'earth' }])
  assert.equal(s.powerInventory.red.earth, 1)
})

test('a human gets the floating picker; the pick applies when they choose', () => {
  const s = scene()
  s._gatePass = 7
  s.animateGateGrant = () => {}
  let opened
  s.showGatePicker = (color, onPick) => { opened = { color, onPick } }
  s.resolveGatePass({ color: 'blue' })
  assert.equal(opened.color, 'blue')
  assert.equal(s._gatePickOwner, 'blue')
  assert.equal(s.powerInventory.blue.water, 0, 'nothing granted until they pick')
  opened.onPick('water')
  assert.equal(s.powerInventory.blue.water, 1)
})

test('a hanging pick is auto-resolved at random when the owner rolls on', () => {
  const s = scene()
  s._gatePass = 7
  s.animateGateGrant = () => {}
  let onPick
  s.showGatePicker = (color, cb) => { onPick = cb; s._gatePickChoose = key => cb(key) }
  s.resolveGatePass({ color: 'blue' })
  assert.equal(typeof onPick, 'function')
  s.autoResolveGatePick()
  // GetRandom stub returns the first entry -> 'fire'
  assert.equal(s.powerInventory.blue.fire, 1)
})

test('pickGateRuneForBot shields an exposed pawn, otherwise spreads picks', () => {
  const s = scene()
  s.pawns = [
    { color: 'red', steps: 6, finished: false },   // red pawn on track index 6
    { color: 'blue', steps: 3, finished: false },  // blue pawn 3 squares behind it
  ]
  s.getPawnCell = pawn => ({ type: 'track', index: pawn.steps })
  assert.equal(s.pickGateRuneForBot('red'), 'earth')

  // once the shield is stocked, fall back to the weighted spread (GetRandom stub
  // is deterministic but the call must still resolve to a valid rune)
  s.powerInventory.red.earth = 2
  assert.ok(board.POWER_TYPES.includes(s.pickGateRuneForBot('red')))
})

test('playPowerEffect fires for opponents, stays quiet for the local you and for air', () => {
  const s = scene()
  // one chainable stub covers circle / graphics / image / particles + drawRestingDice
  const chain = new Proxy(function () {}, { get: () => () => chain, apply: () => chain })
  let spawns = 0
  s.add = { circle: () => { spawns++; return chain }, graphics: () => { spawns++; return chain }, image: () => { spawns++; return chain }, particles: () => { spawns++; return chain } }
  s.textures = { exists: () => true }
  s.cornerDice = { red: { container: { x: 600, y: 120 } }, blue: { container: { x: 120, y: 1100 } } }
  s.youColor = 'blue'

  s.playPowerEffect('blue', 'fire')   // that's "you" - no burst
  assert.equal(spawns, 0)
  s.playPowerEffect('red', 'air')     // air is handled elsewhere
  assert.equal(spawns, 0)
  s.playPowerEffect('red', 'fire')    // an opponent doubled - burst
  assert.ok(spawns > 0)
})

test('a move no longer waits on the gate pick - the turn plays straight on', () => {
  const s = scene()
  s.phase = 'move'
  s.diceValue = 1
  s.rawDiceValue = 1
  const pawn = { color: 'blue', steps: 5 }
  s.stopTurnTimer = s.updatePawnHighlights = s.reflowPawns = s.refreshTurnUI = s.checkForWinner = () => {}
  let moved = 0
  let land
  let gateOpened = 0
  s.animatePawn = (_pawn, _from, _to, callback) => { moved++; land = callback }
  s.resolveGatePass = () => { gateOpened++ }
  s.collectCaptures = () => []
  s.time = { delayedCall() {} }
  s.tryMovePawn(pawn)
  s.tryMovePawn(pawn)
  assert.equal(moved, 1)
  assert.equal(s.phase, 'moving')
  land()
  assert.equal(gateOpened, 1)
  assert.equal(s.currentColor, 'red', 'turn advanced without waiting for a pick')
  assert.equal(s.phase, 'roll')
})

test('a banked air rune becomes the bonus roll on the owner next turn', () => {
  const s = scene()
  s.currentPlayer = 0 // blue to start
  s.pendingExtraRoll.add('blue')
  s.isBot = () => false
  s.startTurnTimer = () => {}
  const cues = []
  s.showExtraRollCue = (color, cause) => cues.push({ color, cause })
  s.beginTurn()
  assert.equal(s.extraRollNextTurn, true)
  assert.equal(s.pendingExtraRoll.has('blue'), false)
  assert.deepEqual(cues, [{ color: 'blue', cause: 'air' }])
})

for (const reason of ['six', 'air', 'capture', 'finish', null]) {
  test(`extra-roll cue follows the actual move reward: ${reason ?? 'none'}`, () => {
    const s = scene()
    s.phase = 'move'
    s.diceValue = 1
    s.rawDiceValue = reason === 'six' ? 6 : 1
    s.extraRollNextTurn = reason === 'air'
    const pawn = { color: 'blue', steps: reason === 'finish' ? 55 : 5 }
    s.stopTurnTimer = s.updatePawnHighlights = s.reflowPawns = s.refreshTurnUI = s.checkForWinner = () => {}
    s.animatePawn = (_pawn, _from, _to, callback) => callback()
    s.resolveGatePass = () => {}
    s.collectCaptures = () => reason === 'capture' ? [{}] : []
    s.playCaptureSequence = (_pawn, _captured, callback) => callback()
    s.time = { delayedCall() {} }
    const cues = []
    s.showExtraRollCue = (color, cause) => cues.push({ color, cause, phase: s.phase })
    s.tryMovePawn(pawn)
    assert.equal(s.currentColor, reason ? 'blue' : 'red')
    assert.equal(cues.length, reason ? 1 : 0)
    if (reason) assert.deepEqual(cues[0], { color: 'blue', cause: reason, phase: 'roll' })
    assert.equal(s.extraRollNextTurn, false)
  })
}

for (const raw of [1, 6]) {
  test(`no-move roll of ${raw} only announces an earned extra roll`, () => {
    const s = scene()
    s.rawDiceValue = raw
    s.refreshTurnUI = () => {}
    s.time = { delayedCall() {} }
    const cues = []
    s.showExtraRollCue = (color, reason) => cues.push({ color, reason })
    s.nextTurn()
    assert.equal(s.currentColor, raw === 6 ? 'blue' : 'red')
    assert.equal(cues.length, raw === 6 ? 1 : 0)
    if (raw === 6) assert.deepEqual(cues[0], { color: 'blue', reason: 'six' })
  })
}

test('winning move does not announce an extra roll', () => {
  const s = scene()
  s.phase = 'move'
  s.diceValue = s.rawDiceValue = 1
  s.stopTurnTimer = s.updatePawnHighlights = () => {}
  s.animatePawn = (_pawn, _from, _to, callback) => callback()
  s.resolveGatePass = () => {}
  s.collectCaptures = () => []
  s.checkForWinner = () => { s.gameOver = true }
  s.showExtraRollCue = () => assert.fail('No bonus after the game ends')
  s.tryMovePawn({ color: 'blue', steps: 55 })
  assert.equal(s.gameOver, true)
})

// ---------- pawn art + motion (unchanged) ----------

for (const steps of [0, 30, 51, 56]) {
  test(`pawn artwork stays aligned on board at step ${steps} and resets in yard`, () => {
    const s = scene()
    const sprite = { width: 200, height: 300, y: 12,
      setY(y) { this.y = y; return this },
      setScale(scale) { this.scale = scale; return this },
    }
    const shield = { setY(y) { this.y = y } }
    const zone = { setY(y) { this.y = y } }
    const restShadow = {
      setVisible(v) { this.visible = v; return this },
      setPosition(x, y) { this.x = x; this.y = y; return this },
    }
    const parts = { token: { getByName: () => sprite }, shield, zone, restShadow }
    const data = { onBoard: false }
    const view = { x: 100, y: 200,
      getData: key => data[key], setData: (key, value) => { data[key] = value },
      getByName: key => parts[key],
    }
    s.layoutPawnView({ steps }, view)
    assert.equal(sprite.y, 24)
    assert.equal(sprite.height * sprite.scale, 56)
    assert.equal(sprite.y - sprite.height * sprite.scale / 2, -4)
    assert.equal(shield.y, -4)
    assert.equal(zone.y, -4)
    assert.equal(view.x, 100)
    assert.equal(view.y, 200)
    const changes = s.killed.length
    s.layoutPawnView({ steps }, view)
    assert.equal(s.killed.length, changes, 'same layout must not interrupt landing animation')
    s.layoutPawnView({ steps: -1 }, view)
    assert.equal(sprite.y, 12)
    assert.equal(sprite.height * sprite.scale, 64)
    assert.equal(shield.y, -16)
  })
}

for (const color of board.COLORS) {
  test(`${color} continuous movement follows tile centers through turns and home entry`, () => {
    const s = scene()
    for (const [from, to] of [[0, 12], [45, 56]]) {
      const points = Array.from({ length: to - from + 1 }, (_, i) => s.getPixelFor(color, from + i))
      for (let i = 0; i < points.length; i++) {
        const sample = pawnMotion.samplePawnPath(points, i / (points.length - 1))
        assert.ok(Math.abs(sample.x - points[i].x) < 1e-8)
        assert.ok(Math.abs(sample.y - points[i].y) < 1e-8)
      }
      for (let i = 0; i <= 100; i++) {
        const sample = pawnMotion.samplePawnPath(points, i / 100)
        assert.ok(Number.isFinite(sample.x) && Number.isFinite(sample.y))
        assert.ok(sample.reached >= 0 && sample.reached < points.length)
      }
    }
  })
}

test('pawn journey resolves only after its final landing settles', () => {
  const s = scene()
  const node = () => ({
    x: 0, y: 0, width: 200, height: 300,
    setPosition(x, y) { this.x = x; this.y = y; return this },
    setY(y) { this.y = y; return this },
    setAngle(angle) { this.angle = angle; return this },
    setScale(x, y = x) { this.scaleX = x; this.scaleY = y; return this },
    setDepth() { return this }, setAlpha() { return this }, setStrokeStyle() { return this },
    setVisible() { return this },
    destroy() {}, getData() { return .78 },
  })
  const sprite = node()
  const token = node()
  token.getByName = () => sprite
  const view = node()
  view.getByName = () => token
  const pawn = { color: 'blue', steps: 6 }
  s.pawnViews.set(pawn, view)
  s.layoutPawnView = () => {}
  s.add = { ellipse: node }
  let completed = 0
  s.animatePawn(pawn, 0, 6, () => completed++)
  const journey = s.pending.find(tween => tween.targets.progress === 0)
  assert.ok(journey)
  journey.targets.progress = .5
  journey.onUpdate()
  assert.equal(completed, 0)
  journey.targets.progress = 1
  journey.onUpdate()
  journey.onComplete()
  assert.equal(completed, 0)
  const landing = s.pending.find(tween => tween.targets === token)
  landing.onComplete()
  assert.equal(completed, 1)
  const end = s.getPixelFor('blue', 6)
  assert.equal(view.x, end.x)
  assert.equal(view.y, end.y)
  assert.equal(token.y, 0)
  assert.equal(token.angle, 0)
  assert.equal(token.scaleX, 1)
})

// Network state is exercised without a socket or renderer, using the actual scene.
stubs['/net/room.js'] = Object.fromEntries([
  'joinMatch', 'soloMatch', 'createRoom', 'joinByCode', 'tryReconnect', 'clearReconnect', 'stashReconnect',
].map(name => [name, () => {}]))
const netModule = await compile(new URL('../src/scenes/NetLudoScene.js', import.meta.url))
await netModule.link(linker)
await netModule.evaluate()
const { NetLudoScene } = netModule.namespace

test('online join tolerates a room before its first schema arrives', () => {
  const s = new NetLudoScene()
  s.init({})
  s.room = { state: {} }
  assert.doesNotThrow(() => s.onStateChange())
  assert.equal(s.g, null)
})

test('a new online match clears animation locks and old render references', () => {
  const s = new NetLudoScene()
  s.init({})
  const run = s._run
  s._animating = true
  s.pawnViews.set({}, {})
  s.bonusRuneViews.set(7, {})
  s.header = {}
  s._gatePickChoose = () => {}
  s.init({})
  assert.equal(s._run, run + 1)
  assert.equal(s._animating, false)
  assert.equal(s.pawnViews.size, 0)
  assert.equal(s.bonusRuneViews.size, 0)
  assert.equal(s.header, null)
  assert.equal(s._gatePickChoose, null)
})

test('opponent water power never changes the local selected dice value', async () => {
  const s = new NetLudoScene()
  s.init({})
  s.myColor = 'blue'
  s.forcedDiceValue = 2
  s.pause = async () => {}
  s.playPowerEffect = () => {}
  await s.playPowerUsed({ color: 'green', key: 'water', value: 6 })
  assert.equal(s.forcedDiceValue, 2)
})

test('online inputs stop while disconnected; gate choices can be out of turn', () => {
  const s = new NetLudoScene()
  s.init({})
  s.myColor = 'blue'
  s.g = { colors: ['blue', 'green'], current: 1 }
  const sent = []
  s.room = { send: (...args) => sent.push(args) }
  s.send({ type: 'roll' })
  assert.equal(sent.length, 0)
  s._connected = true
  s.send({ type: 'roll' })
  assert.equal(sent.length, 0)
  s.send({ type: 'pickGateRune', key: 'earth' })
  assert.equal(sent.length, 1)
})

test('queued event batches play against their matching authoritative state', async () => {
  const s = new NetLudoScene()
  s.init({})
  s.g = { turn: 0 }
  const seen = []
  s.playEvents = async () => { seen.push(s.g.turn) }
  s.onStateChange = () => {}
  s.enqueue({ events: [], game: { turn: 1 } })
  s.enqueue({ events: [], game: { turn: 2 } })
  await s._queue
  assert.deepEqual(seen, [1, 2])
  assert.equal(s._pendingBatches, 0)
})

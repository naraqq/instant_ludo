import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import vm from 'node:vm'
import * as board from '../src/scenes/board.js'
import * as pawnMotion from '../src/ui/pawnMotion.js'

// Evaluate the real scene (now split into mixin modules under scenes/classic/)
// with only the renderer / audio / persistence boundaries stubbed. Every other
// project module is compiled from disk so the whole graph loads for real.
const stubs = {
  phaser: { default: {} },
  '/ui/UIScene.js': { UIScene: class {} },
  '/audio.js': { sfx: { rune() {}, hop() {} } },
  '/store.js': { store: {} },
  '/ai.js': { chooseAiMove() {}, chooseAiPower() {}, bestForcedDice() {} },
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
  s.flashes = []
  s.flashPower = key => s.flashes.push(key)
  s.respawns = []
  s.spawnPowerRune = (type, slot) => s.respawns.push({ type, slot })
  s.getPawnCell = pawn => ({ type: 'track', index: pawn.index })
  return s
}
function placeRune(s, type = 'fire') {
  const rune = { id: `${type}-0`, type, slot: 0, index: 7 }
  const view = display(300, 450)
  s.powerRunes = [rune]
  s.runeViews.set(rune.id, view)
  return { rune, view }
}

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

for (const type of ['fire', 'water', 'earth']) {
  test(`${type} credits immediately and completes once the pickup arrives`, () => {
    const s = scene()
    const { rune, view } = placeRune(s, type)
    let completed = 0
    s.collectPowerRune({ color: 'blue', index: 7 }, () => completed++)
    assert.equal(s.powerInventory.blue[type], 1)
    assert.equal(s.powerButtons[type].countText.text, '1')
    assert.equal(s.powerRunes.length, 0)
    assert.equal(s.runeViews.has(rune.id), false)
    assert.ok(s.killed.includes(view))
    assert.equal(completed, 0)
    assert.equal(s.respawns.length, 0)
    const flight = s.pending.find(tween => tween.targets === view)
    assert.equal(flight.y, s.powerButtons[type].container.y)
    s.collectPowerRune({ color: 'blue', index: 7 })
    assert.equal(s.powerInventory.blue[type], 1)
    flight.onComplete()
    assert.equal(view.destroyed, true)
    assert.equal(s.respawns.length, 1)
    assert.equal(completed, 1)
  })
}

test('enemy pickup flies to enemy avatar and leaves human inventory untouched', () => {
  const s = scene()
  s.currentPlayer = 1
  const { view } = placeRune(s)
  s.collectPowerRune({ color: 'red', index: 7 })
  assert.equal(s.powerInventory.red.fire, 1)
  assert.equal(s.powerInventory.blue.fire, 0)
  assert.equal(s.powerButtons.fire.countText.text, '0')
  const flight = s.pending.find(tween => tween.targets === view)
  assert.equal(flight.y, s.playerBadges.red.y)
  flight.onComplete()
  assert.equal(s.flashes.length, 0)
})

test('air awards an extra roll and bursts locally without an inventory flight', () => {
  const s = scene()
  const { view } = placeRune(s, 'air')
  s.collectPowerRune({ color: 'blue', index: 7 })
  assert.equal(s.extraRollNextTurn, true)
  assert.equal(s.powerInventory.blue.air, undefined)
  const burst = s.pending.find(tween => tween.targets === view)
  assert.equal(burst.x, undefined)
  assert.equal(burst.y, view.y - 12)
  assert.equal(burst.scale, 1.4)
  burst.onComplete()
  assert.equal(view.destroyed, true)
  assert.equal(s.respawns.length, 1)
})

test('missing rune artwork cannot stall collection', () => {
  const s = scene()
  placeRune(s)
  s.runeViews.clear()
  let complete = false
  s.collectPowerRune({ color: 'blue', index: 7 }, () => { complete = true })
  assert.equal(s.powerInventory.blue.fire, 1)
  assert.equal(complete, true)
  assert.equal(s.respawns.length, 1)
})

test('move locks out repeated input and holds turn until collection finishes', () => {
  const s = scene()
  s.phase = 'move'
  s.diceValue = 1
  s.rawDiceValue = 1
  const pawn = { color: 'blue', steps: 5 }
  s.stopTurnTimer = s.updatePawnHighlights = s.reflowPawns = s.refreshTurnUI = s.checkForWinner = () => {}
  let moved = 0
  let land
  let pickupComplete
  s.animatePawn = (_pawn, _from, _to, callback) => { moved++; land = callback }
  s.collectPowerRune = (_pawn, callback) => { pickupComplete = callback }
  s.collectCaptures = () => []
  s.time = { delayedCall() {} }
  s.tryMovePawn(pawn)
  s.tryMovePawn(pawn)
  assert.equal(moved, 1)
  assert.equal(s.phase, 'moving')
  land()
  assert.equal(s.currentColor, 'blue')
  pickupComplete()
  assert.equal(s.currentColor, 'red')
  assert.equal(s.phase, 'roll')
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
    s.collectPowerRune = (_pawn, callback) => callback()
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
  s.collectPowerRune = (_pawn, callback) => callback()
  s.collectCaptures = () => []
  s.checkForWinner = () => { s.gameOver = true }
  s.showExtraRollCue = () => assert.fail('No bonus after the game ends')
  s.tryMovePawn({ color: 'blue', steps: 55 })
  assert.equal(s.gameOver, true)
})

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

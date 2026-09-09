// The power system: the three bottom-bar slots (fire=double / water=control /
// earth=shield), the water "choose your number" picker, the shield visuals, the
// gate picker, and the "+1" bonus-roll runes scattered on the track.
import Phaser from 'phaser'
import { W, H } from '../../config.js'
import { DUR, EASE, dur, prefersReducedMotion } from '../../ui/tokens.js'
import { sfx } from '../../audio.js'
import { t } from '../../i18n.js'
import { drawRestingDice } from '../../ui/dice3d.js'
import { COLOR_HEX, GATE_INDEXES, SAFE_STOPS, START_INDEX, TRACK } from '@ludo/engine'
import { BAR_Y, POD_R, POWER_SLOT_KEYS } from './constants.js'

// The runes offered at a gate - the three storable powers. 'air' (an extra
// roll) is no longer here; it lives on the board as the "+1" bonus rune.
export const GATE_RUNES = ['fire', 'water', 'earth']
const BONUS_RUNE_COUNT = 4

export const PowersMixin = {
  // Three fixed power slots. The icon is the button; a red corner badge shows
  // how many of that power you hold (hidden at zero, like every other game).
  createPowerButtons() {
    this.powerButtons = {}
    const xs = { fire: W / 2 - 100, water: W / 2, earth: W / 2 + 100 }

    POWER_SLOT_KEYS.forEach((key) => {
      const x = xs[key]
      const c = this.add.container(x, BAR_Y).setDepth(48).setData('baseScale', 1)
      c.add(this.add.ellipse(4, 42, 66, 16, 0x000000, 0.3))
      const icon = this.add.image(0, 0, `power-${key}`)
      icon.setScale(84 / icon.height)
      icon.name = 'icon'
      c.add(icon)
      const badge = this.add.container(34, -34)
      badge.add(this.add.circle(2, 2, 15, 0x000000, 0.3))
      badge.add(this.add.circle(0, 0, 15, 0xff4757).setStrokeStyle(2.5, 0xffffff))
      const countText = this.add.text(0, -1, '0', {
        fontFamily: 'Verdana, sans-serif', fontSize: 15, color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0.5)
      badge.add(countText)
      badge.setVisible(false)
      c.add(badge)
      const zone = this.makeHitZone(x, BAR_Y, 92, 92).setDepth(48)
      this.addPressFeedback(zone, c, () => this.usePower(key))
      this.powerButtons[key] = { container: c, icon, badge, countText, zone, owned: false }
    })
  },

  usePower(key) {
    if (this.gameOver) return
    const color = this.currentColor
    if (this.isBot(color) || color !== this.powerBarColor) return
    const inventory = this.powerInventory[color]
    if (!inventory?.[key]) return
    if (this.phase !== 'roll') {
      this.flashPower(key)
      return
    }

    if (key === 'water') {
      this.showControllerPicker()
      return
    }
    sfx.power()

    if (key === 'fire') {
      inventory.fire--
      this.doubleNextRoll = true
      this.flashPower(key)
      this.playPowerEffect(color, 'fire')
      this.updatePowerButtons()
      // Doubling the roll is not a choice you make again afterwards - fire the
      // roll automatically, the same way the water controller does.
      this.time.delayedCall(160, () => this.rollDice())
      return
    }

    if (key === 'earth') {
      inventory.earth--
      this.shieldedColors.add(color)
      this.shieldExpiresOnOwnRoll.delete(color)
      this.flashPower(key)
      this.playPowerEffect(color, 'earth')
      this.playShieldAura(color)
      this.updateShieldVisuals()
      this.updatePowerButtons()
      return
    }
  },

  flashPower(key) {
    const button = this.powerButtons[key]?.container
    if (!button) return
    this.tweens.add({
      targets: button,
      scale: { from: 1.22, to: 1 },
      duration: 240,
      ease: 'Back.easeOut',
    })
  },

  // A power-specific burst on the acting player's own pod / dice tray so every
  // seat can see what just happened - two dice for fire's double, a locked-on
  // face for water's pick, an earthen pulse for the shield.
  playPowerEffect(color, key) {
    if (key === 'air') return
    // The local player already gets the picker / button feedback; this burst is
    // so the OTHER seats can see what a bot or hot-seat rival just did.
    if (color === this.youColor) return
    const tray = this.cornerDice?.[color]?.container
    const badge = this.playerBadges?.[color]
    const anchor = key === 'earth' ? (badge || tray) : (tray || badge)
    if (!anchor) return
    const x = anchor.x
    const y = anchor.y

    const cfg = {
      fire: { tex: 'fx-flame', tint: [0xff3b1f, 0xff9a1f, 0xffd85e], ring: 0xff5c28 },
      water: { tex: 'fx-drop', tint: [0x3bb8ff, 0x86e9ff, 0xffffff], ring: 0x4dc9ff },
      earth: { tex: 'fx-leaf', tint: [0x8a5a2b, 0xc79a55, 0x49d66d], ring: 0x8a6a3a },
    }[key]

    const ring = this.add.circle(x, y, 10, cfg.ring, 0).setStrokeStyle(4, cfg.ring, 0.9).setDepth(70)
    this.tweens.add({
      targets: ring, radius: 50, alpha: { from: 0.9, to: 0 },
      duration: dur(440), ease: EASE.out, onComplete: () => ring.destroy(),
    })
    if (this.textures.exists(cfg.tex)) {
      this.add.particles(x, y, cfg.tex, {
        speed: { min: 80, max: 220 }, angle: { min: 0, max: 360 }, rotate: { min: -180, max: 180 },
        scale: { start: 0.9, end: 0 }, lifespan: 460, quantity: 16, emitting: false, tint: cfg.tint,
      }).setDepth(69).explode(16, x, y)
    }

    if (prefersReducedMotion) return

    if (key === 'fire') {
      // two dice spring apart - the "double roll"
      ;[-1, 1].forEach((side) => {
        const g = this.add.graphics().setPosition(x, y).setDepth(71).setScale(0.15)
        drawRestingDice(g, Phaser.Math.Between(1, 6))
        this.tweens.add({ targets: g, x: x + side * 24, scale: 0.5, duration: dur(DUR.base), ease: EASE.pop })
        this.tweens.add({
          targets: g, y: y - 22, scale: 0.24, alpha: 0,
          delay: dur(480), duration: dur(340), ease: EASE.out, onComplete: () => g.destroy(),
        })
      })
    } else if (key === 'water') {
      // the chosen face, with a reticle snapping onto it
      const g = this.add.graphics().setPosition(x, y).setDepth(71).setScale(0.15)
      drawRestingDice(g, this.forcedDiceValue || 6)
      this.tweens.add({ targets: g, scale: 0.62, duration: dur(DUR.base), ease: EASE.pop })
      this.tweens.add({
        targets: g, y: y - 22, scale: 0.3, alpha: 0,
        delay: dur(520), duration: dur(360), ease: EASE.out, onComplete: () => g.destroy(),
      })
      const lock = this.add.circle(x, y, 34, 0x000000, 0).setStrokeStyle(3, 0x9ff0ff, 0).setDepth(72)
      this.tweens.add({
        targets: lock, radius: 20, alpha: 1, duration: dur(220), ease: EASE.out,
        onComplete: () => this.tweens.add({ targets: lock, alpha: 0, scale: 1.3, duration: dur(320), onComplete: () => lock.destroy() }),
      })
    }

    // the rune itself, popping and fading over the pod
    const icon = this.add.image(x, y - 4, `rune-${key}`).setScale(0).setDepth(73)
    this.tweens.add({ targets: icon, scale: 74 / 240, duration: dur(DUR.base), ease: EASE.pop })
    this.tweens.add({
      targets: icon, scale: 42 / 240, alpha: 0,
      delay: dur(460), duration: dur(360), ease: EASE.out, onComplete: () => icon.destroy(),
    })
  },

  showControllerPicker() {
    const color = this.currentColor
    const inventory = this.powerInventory[color]
    if (!inventory?.water || this.phase !== 'roll') return
    if (this.controllerPicker) this.closeControllerPicker()
    this.stopTurnTimer()

    const panelW = 372
    const panelH = 214
    // sit just above the bottom action bar
    const panelY = BAR_Y - 258
    // columns / rows for a 3x2 grid of dice
    const cols = [-100, 0, 100]
    const rows = [-46, 46]
    const tile = 86

    const overlay = this.add.container(0, 0).setDepth(120)
    const dim = this.add.rectangle(W / 2, H / 2, W, H, 0x05060f, 0.66).setInteractive()
    overlay.add(dim)
    // tapping the dim (outside the panel) cancels without spending the charge
    dim.on('pointerup', () => { sfx.tap(); this.closeControllerPicker(); this.startTurnTimer('roll') })

    const panel = this.add.container(W / 2, panelY)
    overlay.add(panel)
    this.makeRoundedRectTexture('ctrl-panel', panelW, panelH, 0x352a72, 0x1a1145, 28, 0x9b8ae6)
    panel.add(this.add.image(0, 0, 'ctrl-panel').setAlpha(0.99))
    // taps on the panel body (not a die) are swallowed so they don't close it
    overlay.add(this.add.zone(W / 2, panelY, panelW, panelH).setInteractive())

    this.makeRoundedRectTexture('ctrl-die-tile', tile, tile, 0x4a3f92, 0x322a68, 18, 0x7a68c8)
    this.makeRoundedRectTexture('ctrl-die-tile-hot', tile, tile, 0x6b5cc4, 0x4a3f92, 18, 0xd7ccff)

    const pick = (value) => {
      if (this.controllerPicker !== overlay) return
      inventory.water--
      this.forcedDiceValue = value
      this.controllerPicker = null
      this.flashPower('water')
      this.playPowerEffect(color, 'water')
      sfx.power()
      this.updatePowerButtons()
      // Fly the chosen face up to the corner tray, then roll it for real.
      const tray = this.cornerDice[color]?.container
      const chosen = this.add.graphics().setPosition(W / 2, panelY).setDepth(121).setScale(1)
      drawRestingDice(chosen, value)
      overlay.destroy()
      this.tweens.add({
        targets: chosen,
        x: tray ? tray.x : W / 2,
        y: tray ? tray.y : panelY - 220,
        scale: 0.5,
        duration: dur(prefersReducedMotion ? 120 : 320),
        ease: EASE.inOut,
        onComplete: () => { chosen.destroy(); this.rollDice() },
      })
    }

    const tiles = []
    let value = 0
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 3; c++) {
        value++
        const gx = cols[c]
        const gy = rows[r]
        const slot = this.add.container(gx, gy).setData('baseScale', 1)
        const bg = this.add.image(0, 0, 'ctrl-die-tile')
        bg.name = 'bg'
        const die = this.add.graphics().setScale(0.86)
        drawRestingDice(die, value)
        slot.add([bg, die])
        panel.add(slot)
        tiles.push(slot)
        const v = value
        const zone = this.add.zone(W / 2 + gx, panelY + gy, tile, tile).setInteractive({ useHandCursor: true })
        zone.on('pointerover', () => {
          bg.setTexture('ctrl-die-tile-hot')
          this.tweens.add({ targets: slot, scale: 1.09, duration: dur(90), ease: EASE.out })
        })
        zone.on('pointerout', () => {
          bg.setTexture('ctrl-die-tile')
          this.tweens.add({ targets: slot, scale: 1, duration: dur(90), ease: EASE.out })
        })
        zone.on('pointerdown', () => { sfx.tap(); this.tweens.add({ targets: slot, scale: 0.92, duration: dur(70) }) })
        zone.on('pointerup', () => pick(v))
        overlay.add(zone)
      }
    }
    this.controllerPicker = overlay

    if (!prefersReducedMotion) {
      dim.setAlpha(0)
      this.tweens.add({ targets: dim, alpha: 0.66, duration: dur(DUR.fast) })
      panel.setScale(0.84)
      this.tweens.add({ targets: panel, scale: 1, duration: dur(DUR.base), ease: EASE.pop })
      tiles.forEach((slot, i) => {
        slot.setScale(0).setAlpha(0)
        this.tweens.add({
          targets: slot, scale: 1, alpha: 1,
          delay: dur(120 + i * 45), duration: dur(DUR.base), ease: EASE.pop,
        })
      })
    }
  },

  closeControllerPicker() {
    this.controllerPicker?.destroy()
    this.controllerPicker = null
  },

  updatePowerButtons() {
    if (!this.powerButtons) return
    const color = this.powerBarColor
    const inventory = this.powerInventory[color]
    const human = !this.isBot(color)

    POWER_SLOT_KEYS.forEach((key) => {
      const b = this.powerButtons[key]
      const count = human ? inventory?.[key] ?? 0 : 0
      const has = count > 0
      const usable = has && color === this.currentColor && this.phase === 'roll' && !this.gameOver

      // icons always show at full colour - no fading
      b.container.setAlpha(1)
      b.icon.setAlpha(1)
      b.badge.setVisible(has)
      b.countText.setText(`${count}`)
      if (b.zone.input) b.zone.input.enabled = usable

      // pop the icon whenever the count goes up
      if (count > (b.lastCount ?? 0) && !prefersReducedMotion) {
        this.tweens.killTweensOf(b.container)
        this.tweens.add({
          targets: b.container,
          scale: { from: 1.3, to: 1 },
          duration: dur(DUR.base),
          ease: EASE.pop,
        })
      }
      b.lastCount = count
    })
  },

  // ---------- power gates ----------

  createGates() {
    // A gate is a two-pillar energy barrier drawn across the seam between two
    // track squares - you walk THROUGH it, you never stop on it. The barrier art
    // is decoration only; passing any gate offers the same three runes.
    const artFor = ['fire', 'water', 'earth', 'air']
    this.gates = GATE_INDEXES.map((index, i) => {
      const element = artFor[i % artFor.length]
      const before = this.getTrackPixel((index - 1 + TRACK.length) % TRACK.length)
      const after = this.getTrackPixel(index)
      const x = (before.x + after.x) / 2
      const y = (before.y + after.y) / 2
      // the barrier art runs pillar-to-pillar left-to-right; rotate it so the
      // pillars sit either side of the lane the pawn actually travels down.
      const travelsHorizontally = Math.abs(after.x - before.x) > Math.abs(after.y - before.y)
      const c = this.add.container(x, y).setDepth(17)
      const bar = this.add.image(0, 0, `gateline-${element}`).setScale(0.17).setAlpha(0.95)
      if (travelsHorizontally) bar.setAngle(90)
      c.add(bar)
      if (!prefersReducedMotion) {
        this.tweens.add({
          targets: bar, alpha: { from: 0.8, to: 1 },
          duration: 1000, yoyo: true, repeat: -1, ease: EASE.breathe,
        })
      }
      this.gateViews.push(c)
      return { index, element }
    })
  },

  // ---------- "+1" bonus-roll runes (scattered on the track) ----------

  createBonusRunes() {
    for (let i = 0; i < BONUS_RUNE_COUNT; i++) this.spawnBonusRune(i)
  },

  spawnBonusRune(slot) {
    const blocked = this.bonusRunes.filter((r) => r.slot !== slot).map((r) => r.index)
    const rune = { slot, index: this.freeTrackIndex(blocked) }
    this.bonusRunes = this.bonusRunes.filter((r) => r.slot !== slot)
    this.bonusRunes.push(rune)
    const old = this.bonusRuneViews.get(slot)
    if (old) { this.tweens.killTweensOf(old); old.destroy() }
    this.bonusRuneViews.set(slot, this.createBonusRuneView(rune))
  },

  freeTrackIndex(blocked) {
    const taken = new Set(
      this.pawns.map((p) => this.getPawnCell(p)).filter((c) => c.type === 'track').map((c) => c.index)
    )
    const gates = new Set(GATE_INDEXES)
    const options = TRACK
      .map((_, i) => i)
      .filter((i) => !SAFE_STOPS.has(i) && !gates.has(i) && !taken.has(i) && !blocked.includes(i))
    return Phaser.Utils.Array.GetRandom(options.length ? options : TRACK.map((_, i) => i))
  },

  createBonusRuneView(rune) {
    const { x, y } = this.getTrackPixel(rune.index)
    const c = this.add.container(x, y).setDepth(18)
    c.add(this.add.ellipse(2, 14, 24, 7, 0x000000, 0.3))
    const icon = this.add.image(0, -2, 'rune-bonus')
    icon.setScale(36 / icon.height)
    c.add(icon)
    if (!prefersReducedMotion) {
      this.tweens.add({
        targets: c, y: y - 5, scale: 1.06,
        duration: 900, yoyo: true, repeat: -1, ease: EASE.breathe,
      })
    }
    return c
  },

  // Called from the move driver once a pawn settles. Landing on a "+1" rune
  // grants an extra roll (the old air power), then the rune respawns elsewhere.
  collectBonusRune(pawn) {
    const cell = this.getPawnCell(pawn)
    if (cell.type !== 'track') return
    const rune = this.bonusRunes.find((r) => r.index === cell.index)
    if (!rune) return
    this.bonusRunes = this.bonusRunes.filter((r) => r !== rune)
    sfx.rune()
    if (pawn.color === this.currentColor && this.phase === 'moving') {
      this.extraRollNextTurn = true
    } else {
      this.pendingExtraRoll.add(pawn.color)
    }
    this.animateBonusCollect(rune, pawn.color, () => this.spawnBonusRune(rune.slot))
  },

  animateBonusCollect(rune, color, onComplete = () => {}) {
    const view = this.bonusRuneViews.get(rune.slot)
    this.bonusRuneViews.delete(rune.slot)
    if (!view) { onComplete(); return }
    this.tweens.killTweensOf(view)
    view.setDepth(60)
    if (prefersReducedMotion) { view.destroy(); onComplete(); return }
    this.popAt(view.x, view.y, 0xffd54d)
    this.tweens.add({
      targets: view, y: view.y - 16, scale: 1.5, alpha: 0,
      duration: 260, ease: EASE.out,
      onComplete: () => { view.destroy(); onComplete() },
    })
  },

  // A gate sits on the seam just BEFORE track square `index`, so a move "passes"
  // it whenever the pawn's path steps onto that square or beyond (having started
  // before it). Landing exactly on the square counts - that means walking
  // through the arch. Gates are 13 apart, so a move crosses at most one.
  // Returns the crossed gate's track index, or null.
  moveCrossesGate(color, from, to) {
    for (let step = Math.max(from + 1, 0); step <= to && step < 51; step++) {
      const idx = (START_INDEX[color] + step) % TRACK.length
      if (GATE_INDEXES.includes(idx)) return idx
    }
    return null
  },

  // A bright pulse across a gate arch as a pawn walks through it.
  flashGate(index) {
    const i = this.gates?.findIndex((g) => g.index === index)
    if (i == null || i < 0) return
    const c = this.gateViews[i]
    if (!c) return
    const bar = c.list?.[0]
    const { x, y } = c
    const tint = { fire: 0xff5c28, water: 0x4dc9ff, earth: 0x8fd86a, air: 0xffd54d }[this.gates[i].element] ?? 0xffffff
    sfx.rune?.()
    if (bar && !prefersReducedMotion) {
      this.tweens.killTweensOf(bar)
      this.tweens.add({
        targets: bar, scale: { from: 0.24, to: 0.17 }, alpha: { from: 1, to: 0.95 },
        duration: dur(420), ease: EASE.out,
        onComplete: () => {
          bar.setScale(0.17).setAlpha(0.95)
          this.tweens.add({ targets: bar, alpha: { from: 0.8, to: 1 }, duration: 1000, yoyo: true, repeat: -1, ease: EASE.breathe })
        },
      })
    }
    for (let k = 0; k < 2; k++) {
      const ring = this.add.circle(x, y, 6, tint, 0).setStrokeStyle(4 - k, tint, 0.9).setDepth(19)
      this.tweens.add({
        targets: ring, radius: 30 + k * 12, alpha: 0,
        duration: dur(380), delay: dur(k * 80), ease: EASE.out,
        onComplete: () => ring.destroy(),
      })
    }
    if (this.textures.exists('classic-spark')) {
      this.add.particles(x, y, 'classic-spark', {
        speed: { min: 40, max: 150 }, angle: { min: 0, max: 360 },
        scale: { start: 0.7, end: 0 }, lifespan: 420, quantity: 10, emitting: false, tint: [tint, 0xffffff],
      }).setDepth(20).explode(10, x, y)
    }
  },

  // Called from the move driver once the pawn settles. If the move passed a
  // gate, kick off the rune pick - but do NOT hold up the turn for it. Bots
  // pick at once; a human gets a picker that floats over the ongoing game and
  // is resolved whenever they choose (or auto-resolved when their turn returns).
  resolveGatePass(pawn) {
    if (this._gatePass == null) return
    const gateIdx = this._gatePass
    this._gatePass = null
    const color = pawn.color
    this.flashGate(gateIdx)
    const view = this.pawnViews.get(pawn)
    const at = { x: view?.x ?? W / 2, y: view?.y ?? H / 2 }
    const grant = (key) => {
      this.applyGateRune(color, key)
      this.animateGateGrant(color, key, at)
    }
    if (this.isBot(color)) {
      grant(this.pickGateRuneForBot(color))
      return
    }
    this._gatePickOwner = color
    this.showGatePicker(color, grant)
  },

  applyGateRune(color, key) {
    this.powerInventory[color][key]++
    this.updatePowerButtons()
  },

  // Bots favour a shield when a pawn is exposed, otherwise spread their picks,
  // leaning away from a rune they are already hoarding.
  pickGateRuneForBot(color) {
    const inv = this.powerInventory[color]
    const exposed = this.pawns.some((p) => {
      if (p.color !== color || p.steps < 0 || p.finished) return false
      const cell = this.getPawnCell(p)
      if (cell.type !== 'track' || SAFE_STOPS.has(cell.index)) return false
      return this.pawns.some((e) => {
        if (e.color === color || e.steps < 0 || e.finished) return false
        const ec = this.getPawnCell(e)
        if (ec.type !== 'track') return false
        const gap = (cell.index - ec.index + TRACK.length) % TRACK.length
        return gap >= 1 && gap <= 6
      })
    })
    if (exposed && (inv.earth ?? 0) < 2) return 'earth'
    const weights = GATE_RUNES.map((key) => Math.max(1, 3 - (inv[key] ?? 0)))
    const total = weights.reduce((a, w) => a + w, 0)
    let roll = Math.random() * total
    for (let i = 0; i < GATE_RUNES.length; i++) {
      roll -= weights[i]
      if (roll < 0) return GATE_RUNES[i]
    }
    return 'fire'
  },

  animateGateGrant(color, key, at) {
    const ownInventory = color === this.powerBarColor && !this.isBot(color)
    const target = ownInventory ? this.powerButtons?.[key]?.container : this.playerBadges?.[color]
    const flash = () => {
      if (ownInventory && color === this.powerBarColor) this.flashPower(key)
    }
    if (prefersReducedMotion || !target) {
      flash()
      return
    }
    const icon = this.add.image(at.x, at.y - 6, `power-${key}`).setDepth(80)
    icon.setScale(50 / icon.height)
    this.popAt(at.x, at.y, COLOR_HEX[color])
    this.tweens.add({
      targets: icon,
      x: target.x,
      y: target.y,
      scale: icon.scale * 0.4,
      alpha: 0,
      duration: 340,
      ease: 'Cubic.easeInOut',
      onComplete: () => { icon.destroy(); flash() },
    })
  },

  showGatePicker(color, onPick) {
    if (this.gatePicker) this.closeGatePicker()

    const panelW = 372
    const panelH = 268
    const tileW = 106
    const tileH = 154
    const xs = [-116, 0, 116] // one row of three
    const panelY = H / 2

    const overlay = this.add.container(0, 0).setDepth(120)
    // A scrim over the board: the pick is mandatory, so tapping anywhere but a
    // rune tile just nudges the picker (it doesn't auto-resolve or dismiss).
    const dim = this.add.rectangle(W / 2, H / 2, W, H, 0x05060f, 0.44).setInteractive()
    dim.on('pointerup', () => this.bumpGatePicker())
    overlay.add(dim)
    this._gatePickerDim = dim

    const panel = this.add.container(W / 2, panelY)
    overlay.add(panel)
    this._gatePickerPanel = panel
    this.makeRoundedRectTexture('gate-panel', panelW, panelH, 0x352a72, 0x1a1145, 28, 0x9b8ae6)
    panel.add(this.add.image(0, 0, 'gate-panel').setAlpha(0.99))
    panel.add(this.add.text(0, -panelH / 2 + 34, t('classic.gateTitle'), {
      fontFamily: 'Verdana, sans-serif', fontSize: 17, color: '#efe8ff', fontStyle: 'bold',
    }).setOrigin(0.5))
    // swallow taps on the panel body; there is no cancel - a pick is mandatory
    overlay.add(this.add.zone(W / 2, panelY, panelW, panelH).setInteractive())

    this.makeRoundedRectTexture('gate-tile', tileW, tileH, 0x4a3f92, 0x322a68, 18, 0x7a68c8)
    this.makeRoundedRectTexture('gate-tile-hot', tileW, tileH, 0x6b5cc4, 0x4a3f92, 18, 0xd7ccff)

    let done = false
    const choose = (key) => {
      if (done || this.gatePicker !== overlay) return
      done = true
      this.gatePicker = null
      this._gatePickOwner = null
      this._gatePickChoose = null
      this._gatePickerPanel = null
      this._gatePickerDim = null
      this.gatePickerTimeout?.remove(false)
      this.gatePickerTimeout = null
      sfx.power()
      overlay.destroy()
      onPick(key)
    }
    this._gatePickChoose = choose

    const labelKey = {
      fire: 'home.powerFire', water: 'home.powerWater', earth: 'home.powerEarth',
    }
    const tiles = []
    const gy = -panelH / 2 + 46 + tileH / 2
    GATE_RUNES.forEach((key, i) => {
      const gx = xs[i]
      const slot = this.add.container(gx, gy).setData('baseScale', 1)
      const bg = this.add.image(0, 0, 'gate-tile')
      bg.name = 'bg'
      const icon = this.add.image(0, -22, `power-${key}`)
      icon.setScale(76 / icon.height)
      const label = this.add.text(0, 50, t(labelKey[key]), {
        fontFamily: 'Verdana, sans-serif', fontSize: 11, color: '#efe8ff', fontStyle: 'bold',
        align: 'center', wordWrap: { width: tileW - 12 },
      }).setOrigin(0.5)
      slot.add([bg, icon, label])
      panel.add(slot)
      tiles.push(slot)
      const zone = this.add.zone(W / 2 + gx, panelY + gy, tileW, tileH).setInteractive({ useHandCursor: true })
      zone.on('pointerover', () => {
        bg.setTexture('gate-tile-hot')
        this.tweens.add({ targets: slot, scale: 1.06, duration: dur(90), ease: EASE.out })
      })
      zone.on('pointerout', () => {
        bg.setTexture('gate-tile')
        this.tweens.add({ targets: slot, scale: 1, duration: dur(90), ease: EASE.out })
      })
      zone.on('pointerdown', () => { sfx.tap(); this.tweens.add({ targets: slot, scale: 0.94, duration: dur(70) }) })
      zone.on('pointerup', () => choose(key))
      overlay.add(zone)
    })

    this.gatePicker = overlay
    // Safety net so an idle player can't leave a pick hanging indefinitely.
    this.gatePickerTimeout = this.time.delayedCall(25000, () => choose(Phaser.Utils.Array.GetRandom(GATE_RUNES)))

    if (!prefersReducedMotion) {
      dim.setAlpha(0)
      this.tweens.add({ targets: dim, alpha: 0.44, duration: dur(DUR.fast) })
      panel.setScale(0.84)
      this.tweens.add({ targets: panel, scale: 1, duration: dur(DUR.base), ease: EASE.pop })
      tiles.forEach((slot, i) => {
        slot.setScale(0).setAlpha(0)
        this.tweens.add({
          targets: slot, scale: 1, alpha: 1,
          delay: dur(110 + i * 55), duration: dur(DUR.base), ease: EASE.pop,
        })
      })
    }
  },

  // Tried to roll / act with the pick still open - shake the picker so it's
  // clear a rune must be chosen first. Never auto-resolves.
  bumpGatePicker() {
    sfx.tap?.()
    const panel = this._gatePickerPanel
    const dim = this._gatePickerDim
    if (panel && !prefersReducedMotion) {
      this.tweens.killTweensOf(panel)
      this.tweens.add({ targets: panel, scale: { from: 1.09, to: 1 }, duration: dur(300), ease: EASE.pop })
      this.tweens.add({ targets: panel, angle: { from: -2, to: 0 }, duration: dur(260), ease: 'Sine.easeOut' })
    }
    if (dim && !prefersReducedMotion) {
      this.tweens.killTweensOf(dim)
      dim.setAlpha(0.62)
      this.tweens.add({ targets: dim, alpha: 0.44, duration: dur(240) })
    }
  },

  // Last-resort: choose at random. Only for the turn-clock / bot fallback, never
  // a player action.
  autoResolveGatePick() {
    if (this._gatePickChoose) {
      this._gatePickChoose(Phaser.Utils.Array.GetRandom(GATE_RUNES))
    }
  },

  closeGatePicker() {
    this.gatePickerTimeout?.remove(false)
    this.gatePickerTimeout = null
    this._gatePickOwner = null
    this._gatePickChoose = null
    this._gatePickerPanel = null
    this._gatePickerDim = null
    this.gatePicker?.destroy()
    this.gatePicker = null
  },

  updateShieldVisuals() {
    this.pawns.forEach((pawn) => {
      const view = this.pawnViews.get(pawn)
      const shield = view?.getByName('shield')
      if (!shield) return
      // bubble only matters for pawns out on the track
      const wanted = this.shieldedColors.has(pawn.color) && pawn.steps >= 0 && !pawn.finished
      this.tweens.killTweensOf(shield)
      if (!wanted) {
        if (shield.visible && !prefersReducedMotion) {
          this.tweens.add({
            targets: shield, alpha: 0, scale: 0.6, duration: dur(180),
            onComplete: () => shield.setVisible(false),
          })
        } else {
          shield.setVisible(false)
        }
        return
      }
      const forming = !shield.visible
      shield.setVisible(true)
      if (forming && !prefersReducedMotion) {
        shield.setScale(1.7).setAlpha(0)
        this.tweens.add({ targets: shield, scale: 1, alpha: 1, duration: dur(300), ease: EASE.pop })
        this.shieldBurst(view.x, view.y + shield.y * view.scaleY)
      } else {
        shield.setScale(1).setAlpha(1)
      }
      if (!prefersReducedMotion) {
        this.tweens.add({
          targets: shield, scale: 1.07,
          duration: 900, yoyo: true, repeat: -1, ease: EASE.breathe,
        })
      }
    })
  },

  shieldBurst(x, y) {
    const ring = this.add.circle(x, y, 20, 0x8fe6ff, 0).setStrokeStyle(4, 0xcdf4ff, 0.9).setDepth(46)
    this.tweens.add({
      targets: ring, radius: 46, alpha: 0, duration: dur(360), ease: EASE.out,
      onComplete: () => ring.destroy(),
    })
  },

  playShieldAura(color) {
    const badge = this.playerBadges[color]
    if (!badge) return
    const aura = this.add.circle(badge.x, badge.y, POD_R, 0xffffff, 0).setStrokeStyle(5, 0x9ee7ff, 0.85).setDepth(42)
    this.tweens.add({
      targets: aura,
      radius: 64,
      alpha: 0,
      duration: 520,
      ease: 'Cubic.easeOut',
      onComplete: () => aura.destroy(),
    })
  },

  playShieldBlock(pawn) {
    const view = this.pawnViews.get(pawn)
    if (!view) return
    sfx.shield()
    sfx.buzz([18, 30])
    const cx = view.x
    const cy = view.y + (view.getByName('shield')?.y ?? -4) * view.scaleY
    // shockwave rings
    for (let i = 0; i < 2; i++) {
      const ring = this.add.circle(cx, cy, 14, 0xffffff, 0).setStrokeStyle(5 - i * 2, 0xdff8ff, 0.95).setDepth(47)
      this.tweens.add({
        targets: ring, radius: 54 + i * 10, alpha: 0,
        duration: dur(420), delay: dur(i * 90), ease: EASE.out,
        onComplete: () => ring.destroy(),
      })
    }
    // white flash on the bubble
    const bubble = view.getByName('shield')
    if (bubble) {
      this.tweens.killTweensOf(bubble)
      bubble.setScale(1).setAlpha(1)
      this.tweens.add({
        targets: bubble, scale: { from: 1.28, to: 1 }, duration: dur(260), ease: EASE.pop,
        onComplete: () => this.updateShieldVisuals(),
      })
    }
  },
}

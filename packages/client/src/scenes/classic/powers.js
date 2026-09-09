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
import { BAR_Y, POD_R, POWER_SLOT_KEYS, TILE } from './constants.js'

// The runes offered at a gate - the three storable powers. 'air' (an extra
// roll) is no longer here; it lives on the board as the "+1" bonus rune.
export const GATE_RUNES = ['fire', 'water', 'earth']
const BONUS_RUNE_COUNT = 4

export const POWER_META = {
  fire: { name: 'DOUBLE', blurb: 'Your next roll counts twice', tint: 0xff5c28 },
  water: { name: 'CHOOSE', blurb: 'Pick the number you roll', tint: 0x3fb6ff },
  earth: { name: 'SHIELD', blurb: 'Your pawns can’t be sent home', tint: 0x57cf6a },
}
const hxp = (n) => '#' + ((n >>> 0) & 0xffffff).toString(16).padStart(6, '0')

// A rune-coin icon per power, painted once so the three read as one set.
export function powerRuneTexture(scene, key) {
  const id = `power-rune-${key}`
  if (scene.textures.exists(id)) return id
  const S = 2
  const r = 42 * S
  const cv = document.createElement('canvas')
  cv.width = cv.height = r * 2 + 8 * S
  const ctx = cv.getContext('2d')
  const cx = cv.width / 2
  const cy = cv.height / 2
  const tint = POWER_META[key].tint
  // hex coin
  ctx.beginPath()
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 - Math.PI / 2
    const px = cx + Math.cos(a) * r
    const py = cy + Math.sin(a) * r
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
  }
  ctx.closePath()
  const g = ctx.createLinearGradient(cx, cy - r, cx, cy + r)
  g.addColorStop(0, '#ffffff')
  g.addColorStop(0.12, hxp(tint))
  g.addColorStop(1, hxp(((tint & 0xfefefe) >> 1)))
  ctx.fillStyle = g
  ctx.fill()
  ctx.lineWidth = 3.5 * S
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'
  ctx.stroke()
  ctx.save()
  ctx.clip()
  ctx.beginPath()
  ctx.ellipse(cx, cy - r * 0.5, r * 0.8, r * 0.4, 0, 0, 7)
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  ctx.fill()
  ctx.restore()
  // glyph
  ctx.fillStyle = '#ffffff'
  ctx.strokeStyle = 'rgba(0,0,0,0.28)'
  ctx.lineWidth = 3 * S
  ctx.lineJoin = 'round'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  if (key === 'fire') {
    ctx.font = `bold ${r * 1.05}px Verdana, sans-serif`
    ctx.strokeText('×2', cx, cy + 2 * S)
    ctx.fillText('×2', cx, cy + 2 * S)
  } else if (key === 'water') {
    // a die face inside a target ring
    ctx.lineWidth = 4 * S
    ctx.strokeStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(cx, cy, r * 0.62, 0, 7)
    ctx.stroke()
    const s = r * 0.42
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.roundRect(cx - s, cy - s, s * 2, s * 2, 6 * S)
    ctx.fill()
    ctx.fillStyle = hxp(tint)
    for (const [dx, dy] of [[-1, -1], [1, 1], [0, 0]]) {
      ctx.beginPath()
      ctx.arc(cx + dx * s * 0.5, cy + dy * s * 0.5, s * 0.16, 0, 7)
      ctx.fill()
    }
  } else {
    // shield
    ctx.beginPath()
    ctx.moveTo(cx, cy - r * 0.62)
    ctx.lineTo(cx + r * 0.5, cy - r * 0.38)
    ctx.lineTo(cx + r * 0.5, cy + r * 0.12)
    ctx.quadraticCurveTo(cx + r * 0.5, cy + r * 0.55, cx, cy + r * 0.72)
    ctx.quadraticCurveTo(cx - r * 0.5, cy + r * 0.55, cx - r * 0.5, cy + r * 0.12)
    ctx.lineTo(cx - r * 0.5, cy - r * 0.38)
    ctx.closePath()
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.strokeStyle = hxp(tint)
    ctx.lineWidth = 5 * S
    ctx.beginPath()
    ctx.moveTo(cx - r * 0.2, cy + r * 0.04)
    ctx.lineTo(cx - r * 0.02, cy + r * 0.24)
    ctx.lineTo(cx + r * 0.26, cy - r * 0.18)
    ctx.stroke()
  }
  scene.textures.addCanvas(id, cv)
  return id
}

// Programmatic extra-roll badge used on the board and in the power legend.
// The repeat arrow explains the effect without looking like currency or loot.
export function bonusRuneTexture(scene) {
  const id = 'bonus-rune-repeat'
  if (scene.textures.exists(id)) return id
  const S = 2
  const size = 48 * S
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const ctx = cv.getContext('2d')
  const c = size / 2
  const radius = 19 * S

  // Clean ivory chip with a strong gold outline, neutral against every player color.
  ctx.beginPath()
  ctx.arc(c, c, radius, 0, Math.PI * 2)
  ctx.fillStyle = '#fffaf0'
  ctx.fill()
  ctx.strokeStyle = '#e2a915'
  ctx.lineWidth = 3 * S
  ctx.stroke()

  // Circular arrow: one more trip to the dice.
  const arrowRadius = 14.5 * S
  const start = -Math.PI * 0.78
  const end = Math.PI * 1.02
  ctx.beginPath()
  ctx.arc(c, c, arrowRadius, start, end)
  ctx.strokeStyle = '#e2a915'
  ctx.lineWidth = 3.25 * S
  ctx.lineCap = 'round'
  ctx.stroke()
  const ax = c + Math.cos(end) * arrowRadius
  const ay = c + Math.sin(end) * arrowRadius
  ctx.save()
  ctx.translate(ax, ay)
  ctx.rotate(end + Math.PI / 2)
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(-4.5 * S, -3.5 * S)
  ctx.lineTo(4 * S, -4 * S)
  ctx.closePath()
  ctx.fillStyle = '#e2a915'
  ctx.fill()
  ctx.restore()

  ctx.font = `900 ${16 * S}px Arial Black, Verdana, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#4b3500'
  ctx.fillText('+1', c, c + S)

  scene.textures.addCanvas(id, cv)
  return id
}

export const PowersMixin = {
  // Three fixed power slots. The icon is the button; a red corner badge shows
  // how many of that power you hold (hidden at zero, like every other game).
  createPowerButtons() {
    this.powerButtons = {}
    const xs = { fire: W / 2 - 100, water: W / 2, earth: W / 2 + 100 }

    POWER_SLOT_KEYS.forEach((key) => {
      const x = xs[key]
      const c = this.add.container(x, BAR_Y).setDepth(48).setData('baseScale', 1)
      c.add(this.add.ellipse(4, 40, 62, 15, 0x000000, 0.3))
      const icon = this.add.image(0, -6, powerRuneTexture(this, key)).setDisplaySize(70, 70)
      icon.name = 'icon'
      c.add(icon)
      const label = this.add.text(0, 34, POWER_META[key].name, {
        fontFamily: 'Verdana, sans-serif', fontSize: 10, color: '#c7d2e2', fontStyle: 'bold',
      }).setOrigin(0.5)
      c.add(label)
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
  playPowerEffect(color, key, value) {
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
      drawRestingDice(g, value ?? this.forcedDiceValue ?? 6)
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
    this.makeRoundedRectTexture('ctrl-panel', panelW, panelH, 0x21394f, 0x102237, 28, 0x65859b)
    panel.add(this.add.image(0, 0, 'ctrl-panel').setAlpha(0.99))
    // taps on the panel body (not a die) are swallowed so they don't close it
    overlay.add(this.add.zone(W / 2, panelY, panelW, panelH).setInteractive())

    this.makeRoundedRectTexture('ctrl-die-tile', tile, tile, 0x2b4860, 0x1c334b, 18, 0x4d728d)
    this.makeRoundedRectTexture('ctrl-die-tile-hot', tile, tile, 0x3e708b, 0x2b4860, 18, 0x9cdfec)

    const pick = (value) => {
      if (this.controllerPicker !== overlay) return
      if (!this.room) inventory.water--
      if (this.room && (!this._connected || this.currentColor !== color || this.phase !== 'roll')) {
        this.closeControllerPicker()
        return
      }
      this.forcedDiceValue = value
      this.controllerPicker = null
      this.flashPower('water')
      sfx.power()
      this.updatePowerButtons()
      overlay.destroy()
      // The chosen face flies straight to the corner tray and snaps in - then
      // the roll resolves with no tumble (you chose it; it isn't random).
      const tray = this.cornerDice[color]?.container
      const tx = tray ? tray.x : W / 2
      const ty = tray ? tray.y : panelY - 220
      if (prefersReducedMotion || !tray) { this.rollDice(); return }
      const chosen = this.add.graphics().setPosition(W / 2, panelY).setDepth(121).setScale(1)
      drawRestingDice(chosen, value)
      this.tweens.add({
        targets: chosen, x: tx, y: ty, scale: 0.5,
        duration: dur(280), ease: 'Cubic.easeIn',
        onComplete: () => {
          chosen.destroy()
          const ring = this.add.circle(tx, ty, 18, 0x9ff0ff, 0).setStrokeStyle(4, 0x9ff0ff, 0.9).setDepth(60)
          this.tweens.add({
            targets: ring, radius: 42, alpha: { from: 0.9, to: 0 },
            duration: dur(260), ease: 'Cubic.easeOut', onComplete: () => ring.destroy(),
          })
          this.rollDice()
        },
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

  // A gate is a crisp energy line across a track seam with a glowing node at
  // each end - you walk THROUGH it to pick a rune, you never stop on it.
  createGates() {
    const artFor = ['fire', 'water', 'earth', 'air']
    const TINT = { fire: 0xff5c28, water: 0x3fb6ff, earth: 0x57cf6a, air: 0xffcf3f }
    this.gates = GATE_INDEXES.map((index, i) => {
      const element = artFor[i % artFor.length]
      const tint = TINT[element]
      const before = this.getTrackPixel((index - 1 + TRACK.length) % TRACK.length)
      const after = this.getTrackPixel(index)
      const x = (before.x + after.x) / 2
      const y = (before.y + after.y) / 2
      const horiz = Math.abs(after.x - before.x) > Math.abs(after.y - before.y)
      const half = TILE * 0.6
      const c = this.add.container(x, y).setDepth(17)
      const field = this.add.rectangle(0, 0, horiz ? 12 : half * 2, horiz ? half * 2 : 12, tint, 0.16)
      field.name = 'field'
      const beam = this.add.rectangle(0, 0, horiz ? 3.5 : half * 2, horiz ? half * 2 : 3.5, tint, 0.95)
      beam.name = 'beam'
      c.add([field, beam])
      for (const s of [-1, 1]) {
        const node = this.add.circle(horiz ? 0 : s * half, horiz ? s * half : 0, 5.5, tint)
          .setStrokeStyle(2, 0xffffff, 0.75)
        c.add(node)
      }
      if (!prefersReducedMotion) {
        this.tweens.add({
          targets: field, alpha: { from: 0.12, to: 0.28 },
          duration: 1100, yoyo: true, repeat: -1, ease: EASE.breathe,
        })
      }
      this.gateViews.push(c)
      return { index, element, tint, x, y }
    })
  },

  gatePos(index) {
    const g = this.gates?.find((x) => x.index === index)
    return g ? { x: g.x, y: g.y } : null
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
    c.add(this.add.ellipse(2, 13, 27, 7, 0x000000, 0.2))
    const icon = this.add.image(0, -2, bonusRuneTexture(this)).setDisplaySize(36, 36)
    c.add(icon)
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
      this._bonusThisMove = true // finishTurn lets flyBonusToDie light the cue
    } else {
      this.pendingExtraRoll.add(pawn.color)
    }
    // pop the rune off the board and fly a "+1" into this player's dice tray
    const view = this.bonusRuneViews.get(rune.slot)
    this.bonusRuneViews.delete(rune.slot)
    const at = view ? { x: view.x, y: view.y } : this.getTrackPixel(rune.index)
    if (view) { this.tweens.killTweensOf(view); view.destroy() }
    this.popAt(at.x, at.y, 0xffd54d)
    this.spawnBonusRune(rune.slot)
    this.flyBonusToDie(at.x, at.y, pawn.color)
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

  // A bright surge across the gate as a pawn walks through it.
  flashGate(index) {
    const i = this.gates?.findIndex((g) => g.index === index)
    if (i == null || i < 0) return
    const c = this.gateViews[i]
    const g = this.gates[i]
    if (!c) return
    const { x, y, tint } = g
    sfx.rune?.()
    if (!prefersReducedMotion) {
      const field = c.getByName('field')
      const beam = c.getByName('beam')
      ;[field, beam].forEach((el) => {
        if (!el) return
        this.tweens.killTweensOf(el)
        const a0 = el.alpha
        el.setAlpha(1)
        this.tweens.add({
          targets: el, alpha: a0, duration: dur(520), ease: EASE.out,
          onComplete: () => {
            if (el === field) this.tweens.add({ targets: field, alpha: { from: 0.12, to: 0.28 }, duration: 1100, yoyo: true, repeat: -1, ease: EASE.breathe })
          },
        })
      })
      c.setScale(1.18)
      this.tweens.add({ targets: c, scale: 1, duration: dur(320), ease: EASE.pop })
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
    const at = this.gatePos(gateIdx) || { x: view?.x ?? W / 2, y: view?.y ?? H / 2 }
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

  // The chosen rune materialises at the gate, bobs up out of it, then drops and
  // flies to the power bar.
  animateGateGrant(color, key, at) {
    const ownInventory = color === this.powerBarColor && !this.isBot(color)
    const target = ownInventory ? this.powerButtons?.[key]?.container : this.playerBadges?.[color]
    const flash = () => {
      if (ownInventory && color === this.powerBarColor) this.flashPower(key)
      this.updatePowerButtons?.()
    }
    if (prefersReducedMotion || !target) { flash(); return Promise.resolve() }
    const tint = POWER_META[key]?.tint ?? COLOR_HEX[color]
    const compact = Boolean(this._behind)
    this.popAt(at.x, at.y, tint)
    const ring = this.add.circle(at.x, at.y, 6, tint, 0).setStrokeStyle(4, tint, 0.9).setDepth(79)
    this.tweens.add({ targets: ring, radius: 26, alpha: 0, duration: dur(compact ? 180 : 300), ease: EASE.out, onComplete: () => ring.destroy() })
    const icon = this.add.image(at.x, at.y, powerRuneTexture(this, key)).setDepth(80).setAlpha(0)
    const s = 44 / icon.height
    icon.setScale(0)
    return new Promise((resolve) => this.tweens.chain({
      targets: icon,
      tweens: [
        { y: at.y - 20, scale: s * 1.15, alpha: 1, duration: dur(compact ? 90 : 220), ease: EASE.pop },
        { y: at.y - 6, duration: dur(compact ? 40 : 120), ease: 'Sine.easeIn' },
        {
          x: target.x, y: target.y, scale: s * 0.32, alpha: 0,
          duration: dur(compact ? 160 : 360), ease: 'Cubic.easeInOut',
          onComplete: () => { icon.destroy(); flash(); resolve() },
        },
      ],
    }))
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
    this.makeRoundedRectTexture('gate-panel', panelW, panelH, 0x21394f, 0x102237, 28, 0x65859b)
    panel.add(this.add.image(0, 0, 'gate-panel').setAlpha(0.99))
    panel.add(this.add.text(0, -panelH / 2 + 34, t('classic.gateTitle'), {
      fontFamily: 'Verdana, sans-serif', fontSize: 17, color: '#efe8ff', fontStyle: 'bold',
    }).setOrigin(0.5))
    // swallow taps on the panel body; there is no cancel - a pick is mandatory
    overlay.add(this.add.zone(W / 2, panelY, panelW, panelH).setInteractive())

    this.makeRoundedRectTexture('gate-tile', tileW, tileH, 0x2b4860, 0x1c334b, 18, 0x4d728d)
    this.makeRoundedRectTexture('gate-tile-hot', tileW, tileH, 0x3e708b, 0x2b4860, 18, 0x9cdfec)

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
      // Online waits for the authoritative reward event so every client hears
      // its new chime in sync with the flight. Preserve local-mode audio.
      if (!this.room) sfx.power()
      overlay.destroy()
      onPick(key)
    }
    this._gatePickChoose = choose

    const tiles = []
    const gy = -panelH / 2 + 46 + tileH / 2
    GATE_RUNES.forEach((key, i) => {
      const gx = xs[i]
      const slot = this.add.container(gx, gy).setData('baseScale', 1)
      const bg = this.add.image(0, 0, 'gate-tile')
      bg.name = 'bg'
      const icon = this.add.image(0, -26, powerRuneTexture(this, key)).setDisplaySize(64, 64)
      const name = this.add.text(0, 22, POWER_META[key].name, {
        fontFamily: 'Verdana, sans-serif', fontSize: 13, color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0.5)
      const blurb = this.add.text(0, 46, POWER_META[key].blurb, {
        fontFamily: 'Verdana, sans-serif', fontSize: 9.5, color: '#a9c0d6',
        align: 'center', wordWrap: { width: tileW - 14 },
      }).setOrigin(0.5)
      slot.add([bg, icon, name, blurb])
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
      zone.on('pointerdown', () => {
        if (!this.room) sfx.tap()
        this.tweens.add({ targets: slot, scale: 0.94, duration: dur(70) })
      })
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

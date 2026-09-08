// The power system: the three bottom-bar slots, using fire/water/earth, the
// water "choose your number" picker, the shield bubble visuals, and the power
// runes scattered on the track that feed the inventory.
import Phaser from 'phaser'
import { W, H } from '../../config.js'
import { DUR, EASE, dur, prefersReducedMotion } from '../../ui/tokens.js'
import { sfx } from '../../audio.js'
import { drawRestingDice } from '../../ui/dice3d.js'
import { COLOR_HEX, POWER_TYPES, SAFE_STOPS, TRACK } from '../board.js'
import { BAR_Y, POD_R, POWER_SLOT_KEYS } from './constants.js'

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
      const icon = this.add.image(0, 0, `rune-${key}`).setScale(88 / 240)
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

  createPowerRunes() {
    POWER_TYPES.forEach((type) => {
      this.spawnPowerRune(type, 0)
      this.spawnPowerRune(type, 1)
    })
  },

  spawnPowerRune(type, slot) {
    const id = `${type}-${slot}`
    const blocked = this.powerRunes.filter((rune) => rune.id !== id).map((rune) => rune.index)
    const rune = {
      id,
      type,
      slot,
      index: this.getRandomRuneIndex(blocked),
    }

    this.powerRunes = this.powerRunes.filter((item) => item.id !== id)
    this.powerRunes.push(rune)
    const previous = this.runeViews.get(id)
    if (previous) {
      this.tweens.killTweensOf(previous)
      previous.destroy()
    }
    this.runeViews.set(id, this.createRuneView(rune))
  },

  getRandomRuneIndex(blockedIndexes) {
    const occupied = new Set(
      this.pawns
        .map((pawn) => this.getPawnCell(pawn))
        .filter((cell) => cell.type === 'track')
        .map((cell) => cell.index)
    )
    const candidates = TRACK
      .map((_, index) => index)
      .filter((index) => !SAFE_STOPS.has(index) && !blockedIndexes.includes(index) && !occupied.has(index))
    return Phaser.Utils.Array.GetRandom(candidates.length ? candidates : TRACK.map((_, index) => index))
  },

  createRuneView(rune) {
    const { x, y } = this.getTrackPixel(rune.index)
    const c = this.add.container(x, y).setDepth(18)
    c.add(this.add.ellipse(2, 15, 30, 9, 0x000000, 0.3))
    c.add(this.add.image(0, -1, `rune-${rune.type}`).setScale(40 / 240))
    if (!prefersReducedMotion) {
      this.tweens.add({
        targets: c,
        y: y - 5,
        scale: 1.07,
        duration: 900,
        yoyo: true,
        repeat: -1,
        ease: EASE.breathe,
      })
    }
    return c
  },

  collectPowerRune(pawn, onComplete = () => {}) {
    const cell = this.getPawnCell(pawn)
    const rune = cell.type === 'track'
      ? this.powerRunes.find((item) => item.index === cell.index)
      : null
    if (!rune) {
      onComplete()
      return
    }
    // Consume immediately so a pickup cannot be awarded twice while animating.
    this.powerRunes = this.powerRunes.filter(item => item.id !== rune.id)
    sfx.rune()
    if (rune.type === 'air') {
      this.extraRollNextTurn = true
    } else {
      this.powerInventory[pawn.color][rune.type]++
    }
    this.updatePowerButtons()
    this.animateRuneCollect(rune, pawn.color, () => {
      this.spawnPowerRune(rune.type, rune.slot)
      onComplete()
    })
  },

  animateRuneCollect(rune, color, onComplete = () => {}) {
    const view = this.runeViews.get(rune.id)
    this.runeViews.delete(rune.id)
    if (!view) {
      onComplete()
      return
    }
    // Reuse the visible rune, preserving its bobbing position without a jump.
    this.tweens.killTweensOf(view)
    view.setDepth(60)
    const ownInventory = color === this.powerBarColor && !this.isBot(color)
    const target = ownInventory && rune.type !== 'air'
      ? this.powerButtons?.[rune.type]?.container
      : this.playerBadges?.[color]
    const complete = () => {
      view.destroy()
      if (ownInventory && rune.type !== 'air' && color === this.powerBarColor) {
        this.flashPower(rune.type)
      }
      onComplete()
    }
    if (prefersReducedMotion) {
      complete()
      return
    }
    if (rune.type === 'air') {
      // An extra roll is used immediately, so burst on its tile instead of
      // implying that it is being stored in somebody's inventory.
      this.popAt(view.x, view.y, 0xffd54d)
      this.tweens.add({
        targets: view, y: view.y - 12, scale: 1.4, alpha: 0,
        duration: 220, ease: EASE.out, onComplete: complete,
      })
      return
    }
    if (!target) {
      complete()
      return
    }
    this.popAt(view.x, view.y, COLOR_HEX[color])
    this.tweens.add({
      targets: view,
      x: target.x,
      y: target.y,
      scale: .35,
      alpha: 0,
      duration: 320,
      ease: 'Cubic.easeInOut',
      onComplete: complete,
    })
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
    this.cameras.main.shake(120, 0.003)
  },
}

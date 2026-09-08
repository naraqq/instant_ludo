// Player pods (avatars, name tags, turn ring, timer arc), the per-player corner
// dice tray, the "extra roll" cue and the master refreshTurnUI sync.
import { W } from '../../config.js'
import { DUR, EASE, dur, prefersReducedMotion } from '../../ui/tokens.js'
import { sfx } from '../../audio.js'
import { dicePose, drawRestingDice } from '../../ui/dice3d.js'
import { t } from '../../i18n.js'
import { COLORS, COLOR_HEX, COLOR_LIGHT } from '../board.js'
import { POD, POD_R } from './constants.js'

export const PlayersMixin = {
  createPlayers() {
    this.playerBadges = {}
    this.cornerDice = {}
    this.makeRoundedRectTexture('pod-tag', 96, 24, 0x1a1240, 0x120c30, 12, 0x5847a0)

    COLORS.forEach((color) => {
      const pod = POD[color]
      const c = this.add.container(pod.ax, pod.ay).setDepth(30)
      c.add(this.add.circle(4, 6, POD_R, 0x000000, 0.32))
      const ring = this.add.circle(0, 0, POD_R + 6, COLOR_HEX[color], 0.001)
      ring.name = 'ring'
      c.add(ring)
      c.add(this.add.circle(0, 0, POD_R, 0x241a4e).setStrokeStyle(5, COLOR_HEX[color]))
      c.add(this.add.image(1, POD_R - 4, `pawn-${color}-sm`).setOrigin(0.5, 1).setScale(66 / 120))
      const arc = this.add.graphics()
      arc.name = 'arc'
      c.add(arc)

      const tagY = pod.dir === 'up' ? POD_R + 20 : -(POD_R + 20)
      c.add(this.add.image(0, tagY, 'pod-tag').setAlpha(0.96))
      c.add(this.add.text(0, tagY - 1, this.playerName(color), {
        fontFamily: 'Verdana, sans-serif', fontSize: 12,
        color: color === this.youColor ? '#ffe27a' : '#ffffff', fontStyle: 'bold',
      }).setOrigin(0.5))

      this.playerBadges[color] = c
      this.cornerDice[color] = this.createCornerDice(color)
      if (!this.activeColors.includes(color)) {
        c.setVisible(false)
        this.cornerDice[color].container.setVisible(false)
      }
    })
  },

  createCornerDice(color) {
    const pod = POD[color]
    const container = this.add.container(pod.dx, pod.dy).setDepth(34)
    const glow = this.add.circle(0, 0, 39, 0xffffff, 0)
      .setStrokeStyle(2, COLOR_LIGHT[color], 1).setAlpha(0)
    glow.name = 'glow'
    const shadow = this.add.ellipse(2, 25, 48, 12, 0x000000, 0.3)
    // Second shadow + die, revealed only while the fire power doubles the roll.
    const shadow2 = this.add.ellipse(2, 25, 48, 12, 0x000000, 0.3).setVisible(false)
    const face = this.add.graphics().setPosition(0, -1)
    const face2 = this.add.graphics().setPosition(0, -1).setVisible(false)
    const pose = dicePose(1)
    drawRestingDice(face, 1)
    drawRestingDice(face2, 1)
    container.add([glow, shadow, shadow2, face, face2])
    const extraCue = this.add.container(0, 0).setVisible(false)
    const extraRing = this.add.circle(0, 0, 38, 0xffffff, 0)
      .setStrokeStyle(2.5, 0xffd54d)
    const extraPlus = this.add.text(pod.dx < W / 2 ? 59 : -59, -8, '+1', {
      fontFamily: 'Verdana, sans-serif', fontSize: 32, fontStyle: 'bold', color: '#ffda70',
    }).setOrigin(.5).setStroke('#21143d', 4)
    extraCue.add([extraRing, extraPlus])
    container.add(extraCue)
    container.setVisible(false)
    const zone = this.makeHitZone(pod.dx, pod.dy, 82, 82)
    this.addPressFeedback(zone, container, () => {
      if (!this.isBot(this.currentColor)) this.rollDice()
    })
    return { container, face, face2, glow, shadow, shadow2, pose, value: 1, extraCue, extraRing, extraPlus }
  },

  playerName(color) {
    if (color === this.youColor) return t('classic.you')
    if (this.isBot(color)) {
      const botIdx = this.activeColors.filter((c) => this.isBot(c)).indexOf(color) + 1
      return t('classic.cpu', { n: botIdx })
    }
    return t(`color.${color}`)
  },

  clearExtraRollCue(color) {
    const dice = this.cornerDice[color]
    if (!dice?.extraCue) return
    this.tweens.killTweensOf(dice.extraCue)
    this.tweens.killTweensOf(dice.extraRing)
    this.tweens.killTweensOf(dice.extraPlus)
    dice.extraCue.setVisible(false)
  },

  showExtraRollCue(color) {
    if (this.gameOver || this.phase !== 'roll' || this.currentColor !== color) return
    const dice = this.cornerDice[color]
    if (!dice) return
    this.clearExtraRollCue(color)
    dice.extraCue.setVisible(true).setAlpha(1).setY(0)
    dice.extraRing.setScale(1).setAlpha(.8)
    dice.extraPlus.setScale(1).setAlpha(1)
    sfx.extraRoll()
    if (!this.isBot(color)) sfx.buzz([12, 45, 12])
    if (prefersReducedMotion) return
    this.tweens.add({
      targets: dice.extraPlus, scale: { from: .5, to: 1 },
      duration: 320, ease: EASE.pop,
    })
    this.tweens.add({
      targets: dice.extraCue, alpha: { from: 0, to: 1 }, y: { from: 6, to: 0 },
      duration: 180, ease: EASE.out,
    })
    // Hollow rings only; leave the die's background transparent.
    this.tweens.add({
      targets: dice.extraRing, scale: { from: 1, to: 1.35 }, alpha: { from: .8, to: 0 },
      duration: 350, repeat: 1, ease: EASE.out,
    })
  },

  drawTimerArc(frac) {
    const badge = this.playerBadges[this.currentColor]
    const arc = badge?.getByName('arc')
    if (!arc) return
    arc.clear()
    if (frac <= 0) return
    const col = frac < 0.25 ? 0xff5a5a : 0xffffff
    arc.lineStyle(4, col, 0.95)
    arc.beginPath()
    arc.arc(0, 0, POD_R + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac, false)
    arc.strokePath()
  },

  refreshTurnUI(prefix) {
    const color = this.currentColor
    const bot = this.isBot(color)
    const handoff = this._prevColor !== undefined && this._prevColor !== color
    this._prevColor = color

    // active player's pod lifts + glows; others recede
    Object.entries(this.playerBadges).forEach(([key, badge]) => {
      const on = key === color
      this.tweens.killTweensOf(badge)
      this.tweens.add({
        targets: badge,
        scale: on ? 1.16 : 1,
        duration: dur(on && handoff ? DUR.base : DUR.fast),
        ease: on ? EASE.pop : EASE.out,
      })
      this.tweens.add({ targets: badge, alpha: on ? 1 : 0.55, duration: dur(DUR.fast) })
      const ring = badge.getByName('ring')
      if (ring) {
        this.tweens.killTweensOf(ring)
        ring.setFillStyle(COLOR_HEX[key], on ? 0.35 : 0.001)
        ring.setScale(1).setAlpha(1)
        if (on && !prefersReducedMotion) {
          this.tweens.add({ targets: ring, scale: 1.16, alpha: 0.55, duration: 780, yoyo: true, repeat: -1, ease: EASE.breathe })
        }
      }
      if (!on) badge.getByName('arc')?.clear()
    })

    // the active player's whole home quadrant softly blinks
    Object.entries(this.quadFx).forEach(([key, rect]) => {
      this.tweens.killTweensOf(rect)
      if (key === color && !prefersReducedMotion) {
        rect.setFillStyle(COLOR_LIGHT[key]).setAlpha(0.025)
        this.tweens.add({
          targets: rect, alpha: 0.12,
          duration: 620, yoyo: true, repeat: -1, ease: EASE.breathe,
        })
      } else {
        rect.setAlpha(0)
      }
    })

    // only the active player's dice is shown, popping in near their pod
    Object.entries(this.cornerDice).forEach(([key, dice]) => {
      const on = key === color && this.activeColors.includes(key)
      const c = dice.container
      this.tweens.killTweensOf(c)
      this.tweens.killTweensOf(dice.glow)
      // Once we're back to a plain roll, retire the fire power's second die.
      if (this.phase === 'roll' && !this.doubleNextRoll && dice.face2) {
        dice.face2.setVisible(false)
        dice.shadow2.setVisible(false)
        dice.face.setPosition(0, -1).setScale(1)
        dice.shadow.setPosition(2, 25).setScale(1).setAlpha(.3)
        drawRestingDice(dice.face, dice.value)
      }
      if (!on) {
        if (c.visible) {
          this.tweens.add({ targets: c, scale: 0.5, alpha: 0, duration: dur(DUR.fast), ease: EASE.out, onComplete: () => c.setVisible(false) })
        }
        return
      }
      if (!c.visible) {
        c.setVisible(true).setScale(prefersReducedMotion ? 1 : 0.4).setAlpha(prefersReducedMotion ? 1 : 0)
        this.tweens.add({ targets: c, scale: 1, alpha: bot ? 0.95 : 1, duration: dur(DUR.base), ease: EASE.pop })
      } else {
        c.setAlpha(bot ? 0.95 : 1).setScale(1)
      }
      // "hot dice": a lucky 6 is due for this player next roll
      const hot = this.phase === 'roll' && this.sixForced.has(key)
      // Outline only: a filled pulse looks like a flashing background when
      // the die lifts off. Keep the indicator hidden through roll and landing.
      dice.glow.setFillStyle(0xffffff, 0)
        .setStrokeStyle(2, hot ? 0xffd54d : COLOR_LIGHT[key], 1)
        .setVisible(this.phase === 'roll')
      if (!bot && this.phase === 'roll' && !prefersReducedMotion) {
        dice.glow.setScale(1).setAlpha(0)
        this.tweens.add({
          targets: dice.glow,
          alpha: hot ? 0.6 : 0.42,
          scale: hot ? 1.45 : 1.32,
          duration: hot ? 520 : 780,
          yoyo: true,
          repeat: -1,
          ease: EASE.breathe,
        })
      } else {
        dice.glow.setAlpha(hot ? 0.3 : 0)
      }
    })

    this.updatePawnHighlights()
    this.updatePowerButtons()
  },
}
